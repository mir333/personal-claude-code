import { query } from "@anthropic-ai/claude-agent-sdk";
import { v4 as uuidv4 } from "uuid";

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
  return agent.history;
}

export async function sendMessage(id, text, onEvent) {
  const agent = agents.get(id);
  if (!agent) throw new Error("Agent not found");
  if (agent.status === "busy") throw new Error("Agent is busy");

  agent.status = "busy";
  agent.history.push({ role: "user", content: text, timestamp: Date.now() });

  const abortController = new AbortController();
  agent.abortController = abortController;

  try {
    const options = {
      cwd: agent.workingDirectory,
      permissionMode: "acceptEdits",
      includePartialMessages: true,
      abortSignal: abortController.signal,
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
          onEvent({ type: "text_delta", text: event.delta.text });
        }
      }

      // Complete assistant message with tool calls
      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "tool_use") {
            onEvent({
              type: "tool_call",
              tool: block.name,
              input: block.input,
              toolUseId: block.id,
            });
          }
        }
      }

      // Tool results
      if (message.type === "user") {
        for (const block of message.message.content) {
          if (block.type === "tool_result") {
            onEvent({
              type: "tool_result",
              toolUseId: block.tool_use_id,
              output: typeof block.content === "string"
                ? block.content
                : JSON.stringify(block.content),
            });
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
        onEvent({ type: "done", result: resultText, cost: message.total_cost_usd });
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      agent.status = "error";
      onEvent({ type: "error", message: err.message });
      return;
    }
  } finally {
    agent.abortController = null;
    if (agent.status === "busy") agent.status = "idle";
  }
}
