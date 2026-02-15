import { query } from "@anthropic-ai/claude-agent-sdk";
import { v4 as uuidv4 } from "uuid";
import { mkdirSync } from "fs";
import { loadConversation, appendEntry } from "./storage.js";
import { recordUsage } from "./usage.js";

const agents = new Map();

export function createAgent(name, workingDirectory) {
  const id = uuidv4();
  const agent = {
    id,
    name,
    workingDirectory,
    status: "idle",
    history: [],
    sessionId: null,
    abortController: null,
    textBuffer: "",
  };
  agents.set(id, agent);
  return agent;
}

export function getAgent(id) {
  return agents.get(id);
}

export function listAgents() {
  return Array.from(agents.values()).map(({ id, name, workingDirectory, status }) => ({
    id,
    name,
    workingDirectory,
    status,
  }));
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

export async function sendMessage(id, text, onEvent) {
  const agent = agents.get(id);
  if (!agent) throw new Error("Agent not found");
  if (agent.status === "busy") throw new Error("Agent is busy");

  agent.status = "busy";
  agent.history.push({ role: "user", content: text, timestamp: Date.now() });
  agent.textBuffer = "";

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
      includePartialMessages: true,
      abortSignal: abortController.signal,
      settingSources: ["user", "project"],
    };

    if (agent.sessionId) {
      options.resume = agent.sessionId;
    }

    for await (const message of query({ prompt: text, options })) {
      if (abortController.signal.aborted) break;

      // Capture session ID
      if (message.type === "system" && message.subtype === "init") {
        agent.sessionId = message.session_id;
      }

      // Stream text deltas
      if (message.type === "stream_event") {
        const event = message.event;
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
          agent.textBuffer += event.delta.text;
          onEvent({ type: "text_delta", text: event.delta.text });
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
            onEvent(entry);
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
            onEvent(entry);
          }
        }
      }

      // Final result
      if (message.type === "result") {
        const resultText = message.result || "";
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
        recordUsage(doneEvent);

        // Persist request stats as a conversation entry
        appendEntry(agent.workingDirectory, {
          type: "stats",
          cost: doneEvent.cost,
          usage: doneEvent.usage,
          modelUsage: doneEvent.modelUsage,
          numTurns: doneEvent.numTurns,
          durationMs: doneEvent.durationMs,
        });

        onEvent(doneEvent);
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      agent.status = "error";
      appendEntry(agent.workingDirectory, { type: "error", message: err.message });
      onEvent({ type: "error", message: err.message });
      return;
    }
  } finally {
    agent.abortController = null;
    if (agent.status === "busy") agent.status = "idle";
  }
}
