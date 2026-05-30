import crypto from "crypto";
import {
  getTask,
  listTasks,
  runTaskAsSubagent,
  recordRun,
  markTaskRunning,
  clearTaskRunning,
  updateTaskRunStatus,
  notifyRunComplete,
} from "./tasks.js";
import { parseWorkflowSource, validateWorkflow } from "./workflow-dsl.js";
import { chatOnce } from "./authoring.js";

const DEFAULT_MAX_STEPS = 100;
const FORK_CONCURRENCY = 4;

/**
 * Pure-ish graph walk. `deps` must provide:
 *   runTask(taskId, payload) -> { outputText, error }
 *   decide(prompt, incoming, edges) -> chosen edge index (number)
 * Returns { status: "success"|"error", error, state }.
 */
export async function walkWorkflow(dsl, initialPayload, deps, opts = {}) {
  const maxSteps = opts.maxSteps || DEFAULT_MAX_STEPS;
  const nodes = dsl.nodes;
  const state = {};
  let steps = 0;

  for (const id of Object.keys(nodes)) {
    state[id] = { status: "pending", output: null, error: null, startedAt: null, completedAt: null };
  }

  // Walk a linear chain starting at nodeId until it ends (next null) or reaches
  // `stopAt` (used so fork branches stop at their join). Returns the last output.
  async function walkChain(nodeId, payload, stopAt) {
    let currentId = nodeId;
    let currentPayload = payload;
    let lastOutput = payload;

    while (currentId && currentId !== stopAt) {
      if (++steps > maxSteps) {
        throw new Error(`Exceeded max workflow steps (${maxSteps}); possible infinite loop`);
      }
      const node = nodes[currentId];
      const st = state[currentId];
      st.status = "running";
      st.startedAt = Date.now();

      if (node.type === "task") {
        const result = await deps.runTask(node.taskId, currentPayload);
        if (result.error) {
          st.status = "error";
          st.error = result.error;
          st.completedAt = Date.now();
          throw new Error(`Node "${currentId}" failed: ${result.error}`);
        }
        st.output = result.outputText;
        st.status = "success";
        st.completedAt = Date.now();
        lastOutput = result.outputText;
        currentPayload = result.outputText;
        currentId = node.next || null;
      } else if (node.type === "decision") {
        const idx = await deps.decide(node.prompt, currentPayload, node.edges);
        if (typeof idx !== "number" || idx < 0 || idx >= node.edges.length) {
          st.status = "error";
          st.error = "Decision did not return a valid edge";
          st.completedAt = Date.now();
          throw new Error(`Node "${currentId}": decision returned no valid edge`);
        }
        st.chosenEdge = idx;
        st.output = `Chose edge: ${node.edges[idx].condition}`;
        st.status = "success";
        st.completedAt = Date.now();
        currentId = node.edges[idx].next || null;
      } else if (node.type === "fork") {
        const joinId = node.join;
        // Run each branch chain concurrently up to the join, with a small cap.
        const branchOutputs = await runWithConcurrency(
          node.branches.map((b) => () => walkChain(b, currentPayload, joinId)),
          FORK_CONCURRENCY
        );
        st.status = "success";
        st.completedAt = Date.now();
        // Move to the join node and merge.
        const joinNode = nodes[joinId];
        const jst = state[joinId];
        jst.status = "running";
        jst.startedAt = Date.now();
        const merged = node.branches
          .map((b, i) => `### Branch ${b}\n${branchOutputs[i]}`)
          .join("\n\n");
        jst.output = merged;
        jst.status = "success";
        jst.completedAt = Date.now();
        lastOutput = merged;
        currentPayload = merged;
        currentId = joinNode.next || null;
      } else if (node.type === "join") {
        // A join reached directly (not via fork) just passes through.
        st.status = "success";
        st.completedAt = Date.now();
        currentId = node.next || null;
      } else {
        st.status = "error";
        st.error = `Unknown node type ${node.type}`;
        throw new Error(`Node "${currentId}": unknown type`);
      }
    }
    return lastOutput;
  }

  try {
    await walkChain(dsl.start, initialPayload, null);
    return { status: "success", error: null, state };
  } catch (err) {
    return { status: "error", error: err.message, state };
  }
}

async function runWithConcurrency(thunks, limit) {
  const results = new Array(thunks.length);
  let cursor = 0;
  async function worker() {
    while (cursor < thunks.length) {
      const i = cursor++;
      results[i] = await thunks[i]();
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(limit, thunks.length); i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

/** AI decision: returns the chosen edge index. Throws on no valid choice. */
async function decideEdge(prompt, incoming, edges, { model, cwd } = {}) {
  const list = edges.map((e, i) => `${i}: ${e.condition}`).join("\n");
  const system =
    "You are a workflow router. Given the prior step output and a list of " +
    "numbered conditions, choose the SINGLE condition that best matches. " +
    "Reply with ONLY the number of the chosen condition and nothing else.";
  const user =
    `Decision instruction: ${prompt}\n\n` +
    `Prior step output:\n${incoming || "(none)"}\n\n` +
    `Conditions:\n${list}\n\nAnswer with one number:`;
  const text = await chatOnce({ system, messages: [{ role: "user", content: user }], model, cwd });
  const match = String(text).match(/\d+/);
  if (!match) throw new Error("Decision agent did not return a number");
  return parseInt(match[0], 10);
}

/**
 * Production entry point. Parses + validates the workflow on the task, runs it,
 * persists a run record using the existing task run-history machinery.
 */
export async function executeWorkflow(taskId, { payload, runId } = {}) {
  const task = getTask(taskId);
  if (!task || task.kind !== "workflow") return;
  if (!markTaskRunning(taskId)) return;
  if (!runId) runId = crypto.randomUUID();
  const startedAt = Date.now();

  try {
    const { dsl, error } = parseWorkflowSource(task.workflowSource);
    if (error) throw new Error(error);
    const availableTaskIds = listTasks(task.profileId)
      .filter((t) => t.kind !== "workflow")
      .map((t) => t.id);
    const { valid, errors } = validateWorkflow(dsl, availableTaskIds);
    if (!valid) throw new Error("Invalid workflow: " + errors.map((e) => e.message).join("; "));

    const deps = {
      runTask: async (refTaskId, p) => {
        const refTask = getTask(refTaskId);
        if (!refTask) return { outputText: "", error: `Task ${refTaskId} not found` };
        return runTaskAsSubagent(refTask, p, task.profileId, crypto.randomUUID());
      },
      decide: (prompt, incoming, edges) =>
        decideEdge(prompt, incoming, edges, { model: task.model, cwd: task.workingDirectory }),
    };

    const result = await walkWorkflow(dsl, payload || null, deps);
    const completedAt = Date.now();
    const status = result.status === "success" ? "success" : "error";

    // Terminal output = output of the last successful node (best-effort).
    const outputs = Object.values(result.state).filter((s) => s.output);
    const resultSummary = outputs.length ? String(outputs[outputs.length - 1].output).slice(0, 500) : null;

    const runEntry = {
      id: runId, taskId, status, startedAt, completedAt,
      durationMs: completedAt - startedAt, cost: 0, usage: null,
      error: result.error || null, resultSummary, outputFiles: null,
      summaryFilename: null, workflow: true,
    };
    recordRun(task.profileId, taskId, runId, { ...runEntry, nodeState: result.state, dsl });
    updateTaskRunStatus(taskId, status);
    notifyRunComplete({ taskId, runId, task: { ...task }, runEntry });
  } catch (err) {
    const completedAt = Date.now();
    const runEntry = {
      id: runId, taskId, status: "error", startedAt, completedAt,
      durationMs: completedAt - startedAt, cost: 0, usage: null,
      error: err.message, resultSummary: null, outputFiles: null,
      summaryFilename: null, workflow: true,
    };
    recordRun(task.profileId, taskId, runId, { ...runEntry, nodeState: {}, dsl: null });
    updateTaskRunStatus(taskId, "error");
    notifyRunComplete({ taskId, runId, task: { ...task }, runEntry });
  } finally {
    clearTaskRunning(taskId);
  }
}

export function triggerWorkflow(taskId, opts) {
  const task = getTask(taskId);
  if (!task || task.kind !== "workflow") return null;
  const runId = crypto.randomUUID();
  executeWorkflow(taskId, { ...opts, runId });
  return { runId };
}
