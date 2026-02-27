import { query } from "@anthropic-ai/claude-agent-sdk";
import { v4 as uuidv4 } from "uuid";
import { mkdirSync } from "fs";
import { loadConversation, appendEntry } from "./storage.js";
import { recordUsage } from "./usage.js";

const agents = new Map();

export function createAgent(name, workingDirectory, profileId) {
  const id = uuidv4();
  const agent = {
    id,
    name,
    workingDirectory,
    profileId: profileId || null,
    status: "idle",
    history: [],
    sessionId: null,
    abortController: null,
    textBuffer: "",
    interactiveQuestions: true,
    pendingQuestion: null,
    listeners: new Set(),      // Set of callback functions
    eventBuffer: [],           // Array of { index, event } for reconnect backfill
    eventIndex: 0,             // Monotonically increasing event counter
  };
  agents.set(id, agent);
  return agent;
}

export function getAgent(id) {
  return agents.get(id);
}

export function listAgents(profileId) {
  let all = Array.from(agents.values());
  if (profileId) {
    all = all.filter((a) => a.profileId === profileId);
  }
  return all.map(({ id, name, workingDirectory, status, interactiveQuestions, profileId: pid }) => ({
    id,
    name,
    workingDirectory,
    status,
    interactiveQuestions,
    profileId: pid,
  }));
}

export function abortAgent(id) {
  const agent = agents.get(id);
  if (!agent || !agent.abortController) return false;
  agent.abortController.abort();
  return true;
}

export function deleteAgent(id) {
  const agent = agents.get(id);
  if (!agent) return false;
  if (agent.abortController) {
    agent.abortController.abort();
  }
  agents.delete(id);
  return true;
}

export function getHistory(id) {
  const agent = agents.get(id);
  if (!agent) return null;
  return loadConversation(agent.workingDirectory);
}

export function clearContext(id) {
  const agent = agents.get(id);
  if (!agent) return false;
  agent.sessionId = null;
  agent.history = [];
  appendEntry(agent.workingDirectory, {
    type: "context_cleared",
    timestamp: Date.now(),
  });
  return true;
}

export function setInteractiveQuestions(id, value) {
  const agent = agents.get(id);
  if (!agent) return false;
  agent.interactiveQuestions = !!value;
  return true;
}

export function answerQuestion(id, answers) {
  const agent = agents.get(id);
  if (!agent || !agent.pendingQuestion) return false;
  agent.pendingQuestion.resolve(answers);
  return true;
}

export function subscribeAgent(id, listener) {
  const agent = agents.get(id);
  if (!agent) return null;
  agent.listeners.add(listener);
  return agent;
}

export function unsubscribeAgent(id, listener) {
  const agent = agents.get(id);
  if (!agent) return;
  agent.listeners.delete(listener);
}

export function getAgentEventIndex(id) {
  const agent = agents.get(id);
  return agent ? agent.eventIndex : 0;
}

export function getBufferedEvents(id, sinceIndex) {
  const agent = agents.get(id);
  if (!agent) return [];
  return agent.eventBuffer.filter((e) => e.index > sinceIndex).map((e) => e.event);
}

function formatUserAnswer(toolInput, answers) {
  const questions = toolInput?.questions || [];
  const lines = ["The user was asked and provided their answers directly:"];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const answer = answers[String(i)] || "No answer";
    lines.push(`Q: "${q.question}" -> Selected: "${answer}"`);
  }
  lines.push("Proceed based on these user selections.");
  return lines.join("\n");
}

export async function sendMessage(id, text) {
  const agent = agents.get(id);
  if (!agent) throw new Error("Agent not found");
  if (agent.status === "busy") throw new Error("Agent is busy");

  agent.status = "busy";
  agent.eventBuffer = [];
  agent.eventIndex = 0;
  agent.history.push({ role: "user", content: text, timestamp: Date.now() });
  agent.textBuffer = "";

  function emit(event) {
    const eventWithIndex = { ...event, eventIndex: ++agent.eventIndex };
    agent.eventBuffer.push({ index: agent.eventIndex, event: eventWithIndex });
    // Keep buffer bounded to avoid memory leak
    if (agent.eventBuffer.length > 1000) {
      agent.eventBuffer = agent.eventBuffer.slice(-500);
    }
    for (const listener of agent.listeners) {
      try { listener(eventWithIndex); } catch (err) {
        console.error('[agents] listener error:', err.message);
      }
    }
  }

  // Persist user message
  appendEntry(agent.workingDirectory, { type: "user", text });

  // Ensure working directory exists (spawn fails with ENOENT if cwd is missing)
  mkdirSync(agent.workingDirectory, { recursive: true });

  const abortController = new AbortController();
  agent.abortController = abortController;

  try {
    const options = {
      cwd: agent.workingDirectory,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
      abortController,
      settingSources: ["user", "project"],
    };

    // Add PreToolUse hook for interactive questions
    if (agent.interactiveQuestions) {
      options.hooks = {
        PreToolUse: [{
          matcher: "AskUserQuestion",
          hooks: [async (hookInput, toolUseId, { signal }) => {
            // Send question_pending event to client
            emit({ type: "question_pending", input: hookInput.tool_input, toolUseId });

            // Wait for user's answer via Promise
            const answer = await new Promise((resolve, reject) => {
              agent.pendingQuestion = { resolve, reject };
              agent._pendingQuestionInput = hookInput.tool_input;
              agent._pendingQuestionToolUseId = toolUseId;
              signal.addEventListener("abort", () => reject(new Error("Aborted")));
            });
            agent.pendingQuestion = null;
            agent._pendingQuestionInput = null;
            agent._pendingQuestionToolUseId = null;

            // Block the tool with user's answer in the reason
            return {
              decision: "block",
              reason: formatUserAnswer(hookInput.tool_input, answer),
            };
          }],
        }],
      };
    }

    if (agent.sessionId) {
      options.resume = agent.sessionId;
    }

    for await (const message of query({ prompt: text, options })) {
      if (abortController.signal.aborted) break;

      // Capture session ID
      if (message.type === "system" && message.subtype === "init") {
        agent.sessionId = message.session_id;
      }

      // Ignore non-actionable system messages
      if (message.type === "system" && (message.subtype === "compact_boundary" || message.subtype === "hook_response" || message.subtype === "status")) {
        continue;
      }

      // Ignore auth_status messages
      if (message.type === "auth_status") {
        continue;
      }

      // Ignore tool_progress messages
      if (message.type === "tool_progress") {
        continue;
      }

      // Stream text deltas
      if (message.type === "stream_event") {
        const event = message.event;
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
          agent.textBuffer += event.delta.text;
          emit({ type: "text_delta", text: event.delta.text });
        }
      }

      // Complete assistant message with tool calls
      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "tool_use") {
            const entry = {
              type: "tool_call",
              tool: block.name,
              input: block.input,
              toolUseId: block.id,
            };
            appendEntry(agent.workingDirectory, entry);
            emit(entry);
          }
        }
      }

      // Tool results
      if (message.type === "user") {
        for (const block of message.message.content) {
          if (block.type === "tool_result") {
            const entry = {
              type: "tool_result",
              toolUseId: block.tool_use_id,
              output: typeof block.content === "string"
                ? block.content
                : JSON.stringify(block.content),
            };
            appendEntry(agent.workingDirectory, entry);
            emit(entry);
          }
        }
      }

      // Final result
      if (message.type === "result") {
        const resultText = message.subtype === "success" ? (message.result || "") : "";

        // Handle error subtypes
        if (message.subtype !== "success") {
          const errorMsg = message.errors ? message.errors.join("; ") : `Stopped: ${message.subtype}`;
          emit({ type: "error", message: errorMsg });
        }

        agent.history.push({
          role: "assistant",
          content: resultText,
          timestamp: Date.now(),
        });

        // Flush accumulated text buffer as a single assistant entry
        if (agent.textBuffer) {
          appendEntry(agent.workingDirectory, { type: "assistant_stream", text: agent.textBuffer });
          agent.textBuffer = "";
        }

        const doneEvent = {
          type: "done",
          result: resultText,
          cost: message.total_cost_usd,
          usage: message.usage || null,
          modelUsage: message.modelUsage || null,
          numTurns: message.num_turns || 0,
          durationMs: message.duration_ms || 0,
        };
        recordUsage(doneEvent, agent.profileId);

        // Persist request stats as a conversation entry
        appendEntry(agent.workingDirectory, {
          type: "stats",
          cost: doneEvent.cost,
          usage: doneEvent.usage,
          modelUsage: doneEvent.modelUsage,
          numTurns: doneEvent.numTurns,
          durationMs: doneEvent.durationMs,
        });

        emit(doneEvent);
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      agent.status = "error";
      appendEntry(agent.workingDirectory, { type: "error", message: err.message });
      emit({ type: "error", message: err.message });
      return;
    }
  } finally {
    agent.abortController = null;
    agent.pendingQuestion = null;
    agent._pendingQuestionInput = null;
    agent._pendingQuestionToolUseId = null;
    if (agent.status === "busy") agent.status = "idle";
  }
}
