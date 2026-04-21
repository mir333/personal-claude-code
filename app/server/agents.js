import { query } from "@anthropic-ai/claude-agent-sdk";
import { v4 as uuidv4 } from "uuid";
import { mkdirSync } from "fs";
import { loadConversation, appendEntry, loadConversationSlice, clearConversation } from "./storage.js";
import { recordUsage } from "./usage.js";

const agents = new Map();

export function createAgent(name, workingDirectory, profileId, continueSession = false) {
  const id = uuidv4();
  const agent = {
    id,
    name,
    workingDirectory,
    profileId: profileId || null,
    status: "idle",
    history: [],
    sessionId: null,
    continueSession,            // When true, first message uses SDK options.continue to recover previous session
    abortController: null,
    textBuffer: "",
    interactiveQuestions: true,
    pendingQuestion: null,
    model: null,               // Model override (e.g. "claude-opus-4-7")
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
  return all.map(({ id, name, workingDirectory, status, interactiveQuestions, profileId: pid, model, continueSession }) => ({
    id,
    name,
    workingDirectory,
    status,
    interactiveQuestions,
    profileId: pid,
    model: model || null,
    continueSession: continueSession || false,
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

export function getHistory(id, limit, offset) {
  const agent = agents.get(id);
  if (!agent) return null;
  if (limit != null) {
    return loadConversationSlice(agent.workingDirectory, limit, offset);
  }
  return loadConversation(agent.workingDirectory);
}

export function clearContext(id) {
  const agent = agents.get(id);
  if (!agent) return false;
  agent.sessionId = null;
  agent.history = [];
  agent.continueSession = false;
  appendEntry(agent.workingDirectory, {
    type: "context_cleared",
    timestamp: Date.now(),
  });
  return true;
}

export function clearHistory(id) {
  const agent = agents.get(id);
  if (!agent) return false;
  agent.sessionId = null;
  agent.history = [];
  agent.continueSession = false;
  clearConversation(agent.workingDirectory);
  return true;
}

export function setInteractiveQuestions(id, value) {
  const agent = agents.get(id);
  if (!agent) return false;
  agent.interactiveQuestions = !!value;
  return true;
}

export function setAgentModel(id, model) {
  const agent = agents.get(id);
  if (!agent) return false;
  agent.model = model || null;
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

export async function sendMessage(id, text, attachments = null) {
  const agent = agents.get(id);
  if (!agent) throw new Error("Agent not found");
  if (agent.status === "busy") throw new Error("Agent is busy");

  agent.status = "busy";
  agent.eventBuffer = [];
  agent.eventIndex = 0;
  agent.history.push({ role: "user", content: text, timestamp: Date.now() });
  agent.textBuffer = "";

  function emit(event) {
    if (!event) return;
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

  // Notify listeners immediately that the agent is busy
  emit({ type: "agent_status", status: "busy" });

  // Persist user message (store attachment metadata only, no binary data)
  const storageEntry = { type: "user", text, timestamp: Date.now() };
  if (attachments && attachments.length > 0) {
    storageEntry.attachments = attachments.map((a) => ({ name: a.name, type: a.type, mediaType: a.mediaType }));
  }
  appendEntry(agent.workingDirectory, storageEntry);

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

    // Apply model override if set
    if (agent.model) {
      options.model = agent.model;
    }

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
    } else if (agent.continueSession) {
      // Recover the most recent SDK session for this working directory.
      // The SDK persists sessions to ~/.claude/projects/ and options.continue
      // tells it to load and resume the latest one automatically.
      options.continue = true;
      agent.continueSession = false; // Only on the first message; subsequent ones use sessionId
    }

    // Build prompt: use content blocks (AsyncIterable<SDKUserMessage>) when
    // there are binary attachments (images/PDFs) so Claude receives them as
    // native content. For text-only messages, keep the simple string format.
    const imageAttachments = attachments?.filter((a) => a.type === "image") || [];
    const pdfAttachments = attachments?.filter((a) => a.type === "pdf") || [];
    const hasBinaryAttachments = imageAttachments.length > 0 || pdfAttachments.length > 0;
    let prompt;

    if (hasBinaryAttachments) {
      const contentBlocks = [];

      // Add image content blocks first (images before text is best practice)
      for (const img of imageAttachments) {
        contentBlocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: img.mediaType,
            data: img.data,
          },
        });
      }

      // Add PDF content blocks as documents
      for (const pdf of pdfAttachments) {
        contentBlocks.push({
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: pdf.data,
          },
        });
      }

      // Add text block (may include <file> XML for text file attachments)
      if (text && text.trim()) {
        contentBlocks.push({ type: "text", text });
      }

      const sessionId = agent.sessionId || uuidv4();
      async function* messageStream() {
        yield {
          type: "user",
          message: { role: "user", content: contentBlocks },
          parent_tool_use_id: null,
          session_id: sessionId,
        };
      }
      prompt = messageStream();
    } else {
      prompt = text;
    }

    for await (const message of query({ prompt, options })) {
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
          console.error(`[agents] Agent ${agent.id} (${agent.name}) result error subtype=${message.subtype}:`, errorMsg);
          emit({
            type: "error",
            message: errorMsg,
            name: message.subtype || "Error",
            details: message.errors || null,
            timestamp: Date.now(),
          });
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
      console.error(`[agents] Agent ${agent.id} (${agent.name}) error:`, err);
      agent.status = "error";
      const errorEntry = {
        type: "error",
        message: err.message,
        name: err.name || "Error",
        stack: err.stack || null,
        code: err.code || null,
        timestamp: Date.now(),
      };
      appendEntry(agent.workingDirectory, errorEntry);
      emit(errorEntry);
      return;
    }
    // AbortError: agent was stopped by user — flush any buffered text and emit done
    if (agent.textBuffer) {
      appendEntry(agent.workingDirectory, { type: "assistant_stream", text: agent.textBuffer });
      agent.textBuffer = "";
    }
    appendEntry(agent.workingDirectory, { type: "stats", cost: null, usage: null, modelUsage: null, numTurns: 0, durationMs: 0 });
    emit({ type: "done", result: "", cost: null, usage: null, modelUsage: null, numTurns: 0, durationMs: 0 });
  } finally {
    agent.abortController = null;
    agent.pendingQuestion = null;
    agent._pendingQuestionInput = null;
    agent._pendingQuestionToolUseId = null;
    if (agent.status === "busy") agent.status = "idle";
  }
}
