import { query } from "@anthropic-ai/claude-agent-sdk";

/**
 * One-shot, stateless chat with no tools and no conversation persistence.
 * Builds a single prompt from a system preamble + message transcript.
 * Returns the assistant's text.
 */
export async function chatOnce({ system, messages, model, cwd }) {
  const transcript = (messages || [])
    .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
    .join("\n\n");
  const prompt = `${system}\n\n${transcript}\n\nAssistant:`;
  const options = {
    cwd: cwd || process.cwd(),
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    settingSources: [],
  };
  if (model) options.model = model;

  let out = "";
  for await (const message of query({ prompt, options })) {
    if (message.type === "result") {
      out = message.subtype === "success" ? (message.result || "") : "";
    }
  }
  return out;
}

const DSL_REFERENCE = `Workflow DSL (JSON):
{
  "name": "string",
  "start": "<node id>",
  "nodes": {
    "<id>": { "type": "task", "taskId": "<existing task id>", "next": "<id|null>" },
    "<id>": { "type": "decision", "prompt": "string",
              "edges": [ { "condition": "string", "next": "<id>" } ] },
    "<id>": { "type": "fork", "branches": ["<id>", "<id>"], "join": "<join id>" },
    "<id>": { "type": "join", "next": "<id|null>" }
  }
}
Rules: every 'next'/edge/branch/join must reference an existing node; task nodes
reference existing task ids; fork needs >=2 branches and a matching join; a
decision picks exactly one edge. 'next': null ends the workflow.`;

/** Build the system preamble for the authoring assistant. */
export function buildAuthoringSystem(mode, taskList) {
  if (mode === "workflow") {
    const tasks = (taskList || [])
      .map((t) => `- id: ${t.id} | name: ${t.name} | dir: ${t.workingDirectory}\n  prompt: ${(t.prompt || "").slice(0, 160)}`)
      .join("\n");
    return (
      "You help the user author a workflow definition in the JSON DSL below. " +
      "Always return the full workflow as a single fenced ```json code block, " +
      "referencing only the available tasks by their real ids.\n\n" +
      DSL_REFERENCE +
      "\n\nAvailable tasks:\n" +
      (tasks || "(none)")
    );
  }
  return (
    "You help the user write an effective single-task prompt for an autonomous " +
    "coding agent. When proposing a prompt, return it as a single fenced ``` " +
    "code block so it can be applied to the editor."
  );
}
