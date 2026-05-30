# Workflow Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a workflow-orchestration layer where a special "workflow" task runs a JSON-defined graph of existing tasks, with AI decision routing and fork/join, plus an AI-assisted authoring dialog.

**Architecture:** Workflows are a `kind` of the existing task object carrying a JSON `workflowSource`. A pure DSL module parses/validates/normalizes the graph. An engine walks the graph, spawning ephemeral subagents from referenced task configs (reusing a refactored `runTaskAsSubagent` helper), routing decisions via a stateless `chatOnce` SDK call, and running fork branches concurrently. Validation is exposed via a server endpoint (mirroring `validate-cron`) so the client renders a read-only graph. An authoring dialog calls a stateless chat endpoint that drafts prompts/DSL.

**Tech Stack:** Node 22 (ESM, built-in `node --test`), Express 5, `@anthropic-ai/claude-agent-sdk` (`query`), React 19 + Vite, Monaco editor (already a dep). DSL is JSON. No new npm dependencies.

---

## File Structure

Server (`app/server/`):
- `workflow-dsl.js` (new) — pure: `parseWorkflowSource`, `validateWorkflow`, `buildGraph`. No I/O.
- `workflow-dsl.test.js` (new) — `node --test` unit tests for the above.
- `workflow-engine.js` (new) — `executeWorkflow(taskId, opts, deps?)` graph walk; dependency-injectable for testing.
- `workflow-engine.test.js` (new) — `node --test` walk tests with fake deps.
- `authoring.js` (new) — `chatOnce({ system, messages, model, cwd })` stateless one-shot SDK chat (no storage side effects).
- `tasks.js` (modify) — add `kind`/`workflowSource` to CRUD + load defaults; extract exported `runTaskAsSubagent`; export run-persistence + running-guard helpers; dispatch workflows in `tick()`/`triggerTask`.
- `index.js` (modify) — accept `kind`/`workflowSource` in create/update; add `POST /api/tasks/validate-workflow`; add `POST /api/tasks/author-assistant`; dispatch webhook on `kind`.

Client (`app/client/src/`):
- `lib/workflowGraph.js` (new) — tiny layered layout helper (assign x/y to nodes) for the SVG renderer.
- `components/WorkflowGraph.jsx` (new) — read-only SVG graph renderer (nodes/edges/status/errors).
- `components/AuthoringDialog.jsx` (new) — AI authoring chat dialog with "Apply to editor".
- `components/TaskForm.jsx` (modify) — kind toggle, JSON DSL editor, live validation + graph, authoring buttons.
- `components/TaskDetail.jsx` (modify) — render workflow run graph with per-node status.
- `hooks/useTasks.js` (modify) — carry `kind`/`workflowSource` through create/update.

Test command (run from `app/`): `node --test`
Add to `app/package.json` scripts: `"test": "node --test"`.

---

## Task 1: Workflow DSL — parse, validate, normalize graph

**Files:**
- Create: `app/server/workflow-dsl.js`
- Test: `app/server/workflow-dsl.test.js`
- Modify: `app/package.json` (add test script)

- [ ] **Step 1: Add the test script**

In `app/package.json`, inside `"scripts"`, add after `"start"`:

```json
    "test": "node --test"
```

- [ ] **Step 2: Write the failing tests**

Create `app/server/workflow-dsl.test.js`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWorkflowSource, validateWorkflow, buildGraph } from "./workflow-dsl.js";

const TASK_IDS = ["t-scan", "t-fix", "t-notify", "t-issue"];

function validDsl() {
  return {
    name: "Sweep",
    start: "scan",
    nodes: {
      scan: { type: "task", taskId: "t-scan", next: "route" },
      route: {
        type: "decision",
        prompt: "pick",
        edges: [
          { condition: "found", next: "fork1" },
          { condition: "clean", next: "notify" },
        ],
      },
      fork1: { type: "fork", branches: ["fix", "issue"], join: "merged" },
      fix: { type: "task", taskId: "t-fix", next: "merged" },
      issue: { type: "task", taskId: "t-issue", next: "merged" },
      merged: { type: "join", next: "notify" },
      notify: { type: "task", taskId: "t-notify", next: null },
    },
  };
}

test("parseWorkflowSource parses JSON", () => {
  const { dsl, error } = parseWorkflowSource(JSON.stringify(validDsl()));
  assert.equal(error, null);
  assert.equal(dsl.start, "scan");
});

test("parseWorkflowSource reports JSON errors", () => {
  const { dsl, error } = parseWorkflowSource("{ not json");
  assert.equal(dsl, null);
  assert.ok(error);
});

test("validateWorkflow accepts a valid workflow", () => {
  const { valid, errors } = validateWorkflow(validDsl(), TASK_IDS);
  assert.equal(valid, true, JSON.stringify(errors));
  assert.equal(errors.length, 0);
});

test("validateWorkflow flags missing start", () => {
  const dsl = validDsl();
  delete dsl.start;
  const { valid, errors } = validateWorkflow(dsl, TASK_IDS);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => /start/i.test(e.message)));
});

test("validateWorkflow flags unknown taskId", () => {
  const dsl = validDsl();
  dsl.nodes.scan.taskId = "t-missing";
  const { valid, errors } = validateWorkflow(dsl, TASK_IDS);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.nodeId === "scan" && /task/i.test(e.message)));
});

test("validateWorkflow flags dangling next target", () => {
  const dsl = validDsl();
  dsl.nodes.scan.next = "nowhere";
  const { valid, errors } = validateWorkflow(dsl, TASK_IDS);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.nodeId === "scan" && /nowhere/.test(e.message)));
});

test("validateWorkflow flags decision edge without condition", () => {
  const dsl = validDsl();
  dsl.nodes.route.edges[0].condition = "";
  const { valid, errors } = validateWorkflow(dsl, TASK_IDS);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.nodeId === "route"));
});

test("validateWorkflow flags fork with <2 branches", () => {
  const dsl = validDsl();
  dsl.nodes.fork1.branches = ["fix"];
  const { valid, errors } = validateWorkflow(dsl, TASK_IDS);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.nodeId === "fork1"));
});

test("validateWorkflow flags fork with missing join", () => {
  const dsl = validDsl();
  dsl.nodes.fork1.join = "ghost";
  const { valid, errors } = validateWorkflow(dsl, TASK_IDS);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.nodeId === "fork1" && /join/i.test(e.message)));
});

test("buildGraph returns nodes and edges with errors attached", () => {
  const dsl = validDsl();
  dsl.nodes.scan.taskId = "t-missing";
  const { valid, errors } = validateWorkflow(dsl, TASK_IDS);
  const graph = buildGraph(dsl, errors);
  const scan = graph.nodes.find((n) => n.id === "scan");
  assert.equal(scan.type, "task");
  assert.ok(scan.errors.length > 0);
  // decision edges produce labeled edges
  assert.ok(graph.edges.some((e) => e.from === "route" && e.label));
  assert.equal(valid, false);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd app && node --test workflow-dsl.test.js`
Expected: FAIL — `Cannot find module './workflow-dsl.js'`.

- [ ] **Step 4: Implement the module**

Create `app/server/workflow-dsl.js`:

```javascript
// Pure workflow DSL helpers: parse JSON source, validate the graph, and
// normalize it into nodes/edges for rendering. No I/O, no side effects.

export const NODE_TYPES = ["task", "decision", "fork", "join"];

/** Parse the raw DSL text (JSON). Returns { dsl, error }. */
export function parseWorkflowSource(text) {
  if (typeof text !== "string" || !text.trim()) {
    return { dsl: null, error: "Workflow definition is empty" };
  }
  try {
    const dsl = JSON.parse(text);
    if (!dsl || typeof dsl !== "object" || Array.isArray(dsl)) {
      return { dsl: null, error: "Workflow must be a JSON object" };
    }
    return { dsl, error: null };
  } catch (err) {
    return { dsl: null, error: `Invalid JSON: ${err.message}` };
  }
}

function err(nodeId, message) {
  return { nodeId: nodeId || null, message };
}

/**
 * Validate a parsed DSL object against the set of available task ids.
 * Returns { valid, errors: [{ nodeId, message }] }.
 */
export function validateWorkflow(dsl, availableTaskIds = []) {
  const errors = [];
  const taskIdSet = new Set(availableTaskIds);

  if (!dsl || typeof dsl !== "object") {
    return { valid: false, errors: [err(null, "Workflow must be an object")] };
  }

  const nodes = dsl.nodes && typeof dsl.nodes === "object" ? dsl.nodes : null;
  if (!nodes) {
    return { valid: false, errors: [err(null, "Workflow must have a 'nodes' object")] };
  }
  const ids = Object.keys(nodes);
  const idSet = new Set(ids);

  if (!dsl.start) {
    errors.push(err(null, "Workflow must define a 'start' node id"));
  } else if (!idSet.has(dsl.start)) {
    errors.push(err(null, `start refers to unknown node "${dsl.start}"`));
  }

  const targetExists = (nodeId, target, label) => {
    if (target === null || target === undefined) return; // end of chain
    if (!idSet.has(target)) {
      errors.push(err(nodeId, `${label} points to unknown node "${target}"`));
    }
  };

  for (const id of ids) {
    const node = nodes[id];
    if (!node || typeof node !== "object") {
      errors.push(err(id, "Node must be an object"));
      continue;
    }
    if (!NODE_TYPES.includes(node.type)) {
      errors.push(err(id, `Unknown node type "${node.type}"`));
      continue;
    }

    if (node.type === "task") {
      if (!node.taskId) {
        errors.push(err(id, "task node requires a taskId"));
      } else if (!taskIdSet.has(node.taskId)) {
        errors.push(err(id, `task "${node.taskId}" does not exist`));
      }
      targetExists(id, node.next, "next");
    } else if (node.type === "decision") {
      if (!Array.isArray(node.edges) || node.edges.length === 0) {
        errors.push(err(id, "decision node requires at least one edge"));
      } else {
        node.edges.forEach((e, i) => {
          if (!e || typeof e !== "object") {
            errors.push(err(id, `edge ${i} must be an object`));
            return;
          }
          if (!e.condition || !String(e.condition).trim()) {
            errors.push(err(id, `edge ${i} requires a non-empty condition`));
          }
          targetExists(id, e.next, `edge ${i} next`);
        });
      }
    } else if (node.type === "fork") {
      if (!Array.isArray(node.branches) || node.branches.length < 2) {
        errors.push(err(id, "fork node requires at least 2 branches"));
      } else {
        node.branches.forEach((b) => targetExists(id, b, "branch"));
      }
      if (!node.join) {
        errors.push(err(id, "fork node requires a join"));
      } else if (!idSet.has(node.join)) {
        errors.push(err(id, `fork join points to unknown node "${node.join}"`));
      } else if (nodes[node.join].type !== "join") {
        errors.push(err(id, `fork join "${node.join}" is not a join node`));
      }
    } else if (node.type === "join") {
      targetExists(id, node.next, "next");
    }
  }

  // No nesting: a referenced task must not itself be a workflow. The caller
  // passes only non-workflow task ids in availableTaskIds, so unknown-task
  // errors above already cover this.

  return { valid: errors.length === 0, errors };
}

/**
 * Normalize a DSL into { nodes: [...], edges: [...] } for rendering.
 * Attaches per-node errors (from validateWorkflow output) to each node.
 */
export function buildGraph(dsl, errors = []) {
  const byNode = new Map();
  for (const e of errors) {
    if (!e.nodeId) continue;
    if (!byNode.has(e.nodeId)) byNode.set(e.nodeId, []);
    byNode.get(e.nodeId).push(e.message);
  }
  const globalErrors = errors.filter((e) => !e.nodeId).map((e) => e.message);

  const nodes = [];
  const edges = [];
  const rawNodes = dsl && dsl.nodes && typeof dsl.nodes === "object" ? dsl.nodes : {};

  for (const [id, node] of Object.entries(rawNodes)) {
    nodes.push({
      id,
      type: node?.type || "unknown",
      taskId: node?.taskId || null,
      label: id,
      isStart: dsl?.start === id,
      errors: byNode.get(id) || [],
    });
    if (!node || typeof node !== "object") continue;
    if (node.type === "task" || node.type === "join") {
      if (node.next) edges.push({ from: id, to: node.next, label: "" });
    } else if (node.type === "decision" && Array.isArray(node.edges)) {
      node.edges.forEach((e) => {
        if (e && e.next) edges.push({ from: id, to: e.next, label: e.condition || "" });
      });
    } else if (node.type === "fork" && Array.isArray(node.branches)) {
      node.branches.forEach((b) => edges.push({ from: id, to: b, label: "", kind: "fork" }));
      if (node.join) edges.push({ from: id, to: node.join, label: "join", kind: "join-hint" });
    }
  }

  return { nodes, edges, globalErrors };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd app && node --test workflow-dsl.test.js`
Expected: PASS (all tests).

- [ ] **Step 6: Commit**

```bash
git add app/server/workflow-dsl.js app/server/workflow-dsl.test.js app/package.json
git commit -m "feat: add workflow DSL parser, validator, and graph builder"
```

---

## Task 2: tasks.js — workflow fields, subagent helper, exported run helpers

**Files:**
- Modify: `app/server/tasks.js`
- Test: `app/server/tasks-workflow.test.js`

- [ ] **Step 1: Write the failing test for kind defaults**

Create `app/server/tasks-workflow.test.js`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTaskKind } from "./tasks.js";

test("normalizeTaskKind defaults to 'task'", () => {
  const t = normalizeTaskKind({ name: "x" });
  assert.equal(t.kind, "task");
  assert.equal(t.workflowSource, null);
});

test("normalizeTaskKind preserves workflow kind and source", () => {
  const t = normalizeTaskKind({ name: "x", kind: "workflow", workflowSource: "{}" });
  assert.equal(t.kind, "workflow");
  assert.equal(t.workflowSource, "{}");
});

test("normalizeTaskKind coerces unknown kind to 'task'", () => {
  const t = normalizeTaskKind({ name: "x", kind: "bogus" });
  assert.equal(t.kind, "task");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && node --test tasks-workflow.test.js`
Expected: FAIL — `normalizeTaskKind` is not exported.

- [ ] **Step 3: Add `normalizeTaskKind` and wire it into CRUD/load**

In `app/server/tasks.js`, add this helper near the top (after the imports / `SUMMARY_INSTRUCTION`):

```javascript
// Normalize workflow-related fields on a task object (mutates and returns it).
export function normalizeTaskKind(task) {
  task.kind = task.kind === "workflow" ? "workflow" : "task";
  task.workflowSource = task.kind === "workflow" ? (task.workflowSource || null) : null;
  return task;
}
```

In `createTask`, add to the `task` object literal (after `prompt: config.prompt,`):

```javascript
    kind: config.kind === "workflow" ? "workflow" : "task",
    workflowSource: config.kind === "workflow" ? (config.workflowSource || null) : null,
```

In `updateTask`, add before `task.updatedAt = Date.now();`:

```javascript
  if (updates.kind !== undefined) task.kind = updates.kind === "workflow" ? "workflow" : "task";
  if (updates.workflowSource !== undefined) {
    task.workflowSource = updates.workflowSource || null;
  }
  if (task.kind !== "workflow") task.workflowSource = null;
```

In `startTaskScheduler`, inside the `for (const task of diskTasks)` loop, after `task.emails = task.emails || [];` add:

```javascript
      normalizeTaskKind(task);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && node --test tasks-workflow.test.js`
Expected: PASS.

- [ ] **Step 5: Extract `runTaskAsSubagent` and export run helpers**

In `app/server/tasks.js`, add this exported helper (place it above `executeTask`). It contains the agent-run core currently inlined in `executeTask`:

```javascript
/**
 * Run a single task's prompt in a fresh ephemeral subagent and return its text
 * output. Used by both executeTask and the workflow engine. Does NOT touch the
 * task's run history or runningJobs — the caller owns lifecycle/persistence.
 */
export async function runTaskAsSubagent(task, payload, profileId, runId) {
  if (!fs.existsSync(task.workingDirectory)) {
    throw new Error(`Working directory does not exist: ${task.workingDirectory}`);
  }
  const conversation = [];
  const summaryFilename = generateSummaryFilename(task.name, runId);
  const agent = createAgent(`wf-${task.name}-${runId}`, task.workingDirectory, profileId);
  agent.interactiveQuestions = false;
  if (task.model) agent.model = task.model;

  const listener = (event) => conversation.push(event);
  subscribeAgent(agent.id, listener);
  try {
    const prompt = payload
      ? `${task.prompt}\n\n${payload}${SUMMARY_INSTRUCTION}`
      : `${task.prompt}${SUMMARY_INSTRUCTION}`;
    await sendMessage(agent.id, prompt);
    unsubscribeAgent(agent.id, listener);

    const doneEvent = conversation.find((e) => e.type === "done");
    const assistantTexts = conversation
      .filter((e) => e.type === "text_delta")
      .map((e) => e.text)
      .join("");
    const errorEvent = conversation.find((e) => e.type === "error");

    const summaryPath = persistSummaryToWorkspace(
      task.workingDirectory, summaryFilename, conversation, assistantTexts
    );

    return {
      outputText: assistantTexts,
      cost: doneEvent?.cost || 0,
      usage: doneEvent?.usage || null,
      error: errorEvent ? errorEvent.message : null,
      summaryFilename,
      summaryPath,
      conversation,
    };
  } finally {
    try { deleteAgent(agent.id); } catch {}
  }
}
```

Then export run-persistence and running-guard helpers the engine needs. Add at the end of `app/server/tasks.js`:

```javascript
// --- Helpers exposed for the workflow engine ---

export function getRunOutputDirForTask(profileId, taskId, runId) {
  return getRunOutputDir(profileId, taskId, runId);
}

export function recordRun(profileId, taskId, runId, runEntry, detail) {
  saveRunDetail(profileId, taskId, runId, detail);
  appendRunEntry(profileId, taskId, runEntry);
}

export function markTaskRunning(taskId) {
  if (runningJobs.has(taskId)) return false;
  runningJobs.set(taskId, { agentId: null, aborted: false, workflow: true });
  return true;
}

export function clearTaskRunning(taskId) {
  runningJobs.delete(taskId);
}

export function updateTaskRunStatus(taskId, status) {
  const task = tasks.get(taskId);
  if (!task) return;
  task.lastRunAt = Date.now();
  task.lastRunStatus = status;
  if (task.cronExpression) task.nextRunAt = computeNextRun(task.cronExpression);
  persistTasks(task.profileId);
}

export function notifyRunComplete(payload) {
  for (const cb of runCompleteListeners) {
    try { cb(payload); } catch {}
  }
}

export { generateSummaryFilename };
```

- [ ] **Step 6: Refactor `executeTask` to use `runTaskAsSubagent` (optional but DRY)**

Leave `executeTask` functionally unchanged for now (it still works). Do NOT rewrite it in this task to avoid risk; the shared helper is additive. (A later cleanup can route `executeTask` through it.)

- [ ] **Step 7: Run the full server test suite**

Run: `cd app && node --test`
Expected: PASS (workflow-dsl + tasks-workflow tests).

- [ ] **Step 8: Commit**

```bash
git add app/server/tasks.js app/server/tasks-workflow.test.js
git commit -m "feat: add workflow task fields and runTaskAsSubagent helper"
```

---

## Task 3: workflow-engine.js — graph walk with decisions and fork/join

**Files:**
- Create: `app/server/workflow-engine.js`
- Test: `app/server/workflow-engine.test.js`

The engine is dependency-injectable: `executeWorkflow(task, { payload, runId }, deps)` where `deps = { runTask, decide, persist }`. Production wiring supplies real implementations; tests supply fakes.

- [ ] **Step 1: Write the failing tests**

Create `app/server/workflow-engine.test.js`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { walkWorkflow } from "./workflow-engine.js";

function dsl() {
  return {
    name: "T",
    start: "scan",
    nodes: {
      scan: { type: "task", taskId: "t-scan", next: "route" },
      route: {
        type: "decision",
        prompt: "pick",
        edges: [
          { condition: "found", next: "fork1" },
          { condition: "clean", next: "notify" },
        ],
      },
      fork1: { type: "fork", branches: ["fix", "issue"], join: "merged" },
      fix: { type: "task", taskId: "t-fix", next: "merged" },
      issue: { type: "task", taskId: "t-issue", next: "merged" },
      merged: { type: "join", next: "notify" },
      notify: { type: "task", taskId: "t-notify", next: null },
    },
  };
}

function fakeDeps(opts = {}) {
  const ran = [];
  return {
    ran,
    runTask: async (taskId, payload) => {
      ran.push(taskId);
      return { outputText: `out:${taskId}`, error: opts.failTask === taskId ? "boom" : null };
    },
    decide: async (prompt, incoming, edges) => {
      // choose by configured branch label, default first
      const want = opts.choose || edges[0].condition;
      const idx = edges.findIndex((e) => e.condition === want);
      return idx >= 0 ? idx : 0;
    },
  };
}

test("walk runs task -> decision(clean) -> notify", async () => {
  const deps = fakeDeps({ choose: "clean" });
  const res = await walkWorkflow(dsl(), "init", deps);
  assert.equal(res.status, "success");
  assert.deepEqual(deps.ran, ["t-scan", "t-notify"]);
  assert.equal(res.state.scan.status, "success");
  assert.equal(res.state.route.chosenEdge, 1);
});

test("walk runs fork branches then join then notify", async () => {
  const deps = fakeDeps({ choose: "found" });
  const res = await walkWorkflow(dsl(), "init", deps);
  assert.equal(res.status, "success");
  // scan first, then fix+issue (order within fork not guaranteed), then notify last
  assert.equal(deps.ran[0], "t-scan");
  assert.equal(deps.ran[deps.ran.length - 1], "t-notify");
  assert.ok(deps.ran.includes("t-fix"));
  assert.ok(deps.ran.includes("t-issue"));
  assert.equal(res.state.merged.status, "success");
});

test("walk fails the run when a task errors", async () => {
  const deps = fakeDeps({ choose: "found", failTask: "t-fix" });
  const res = await walkWorkflow(dsl(), "init", deps);
  assert.equal(res.status, "error");
  assert.ok(res.error);
});

test("walk enforces max-step cap on cycles", async () => {
  const looping = {
    name: "L",
    start: "a",
    nodes: {
      a: { type: "task", taskId: "t", next: "a" }, // self loop
    },
  };
  const deps = fakeDeps();
  const res = await walkWorkflow(looping, "init", deps, { maxSteps: 5 });
  assert.equal(res.status, "error");
  assert.ok(/max/i.test(res.error));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && node --test workflow-engine.test.js`
Expected: FAIL — `Cannot find module './workflow-engine.js'`.

- [ ] **Step 3: Implement the engine walk**

Create `app/server/workflow-engine.js`:

```javascript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && node --test workflow-engine.test.js`
Expected: PASS (the 4 walk tests; `executeWorkflow`/`decideEdge` are not exercised by unit tests).

- [ ] **Step 5: Run full suite**

Run: `cd app && node --test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/server/workflow-engine.js app/server/workflow-engine.test.js
git commit -m "feat: add workflow execution engine with fork/join and decisions"
```

---

## Task 4: authoring.js + server wiring (endpoints + dispatch)

**Files:**
- Create: `app/server/authoring.js`
- Modify: `app/server/index.js`
- Modify: `app/server/tasks.js` (dispatch in `tick`)

- [ ] **Step 1: Create the stateless chat helper**

Create `app/server/authoring.js`:

```javascript
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
```

- [ ] **Step 2: Add `validate-workflow` and `author-assistant` endpoints**

In `app/server/index.js`, add new imports near the tasks import block:

```javascript
import { parseWorkflowSource, validateWorkflow, buildGraph } from "./workflow-dsl.js";
import { chatOnce, buildAuthoringSystem } from "./authoring.js";
import { triggerWorkflow } from "./workflow-engine.js";
```

Add these routes (place them right after the existing `app.post("/api/tasks", ...)` handler, near line 2270):

```javascript
app.post("/api/tasks/validate-workflow", (req, res) => {
  const profileId = req.profile?.id || null;
  const { workflowSource } = req.body || {};
  const { dsl, error } = parseWorkflowSource(workflowSource || "");
  if (error) {
    return res.json({ valid: false, errors: [{ nodeId: null, message: error }], graph: { nodes: [], edges: [], globalErrors: [error] } });
  }
  const availableTaskIds = listAllTasks(profileId)
    .filter((t) => t.kind !== "workflow")
    .map((t) => t.id);
  const { valid, errors } = validateWorkflow(dsl, availableTaskIds);
  const graph = buildGraph(dsl, errors);
  res.json({ valid, errors, graph });
});

app.post("/api/tasks/author-assistant", async (req, res) => {
  const profileId = req.profile?.id || null;
  const { mode, messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages required" });
  }
  try {
    const taskList = mode === "workflow"
      ? listAllTasks(profileId).filter((t) => t.kind !== "workflow")
          .map((t) => ({ id: t.id, name: t.name, workingDirectory: t.workingDirectory, prompt: t.prompt }))
      : [];
    const system = buildAuthoringSystem(mode, taskList);
    const reply = await chatOnce({ system, messages });
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 3: Accept `kind`/`workflowSource` in create and update**

In `app.post("/api/tasks", ...)`: change the destructure to include the new fields and relax the prompt requirement for workflows:

Replace:
```javascript
  const { name, cronExpression, workingDirectory, prompt, model, emails } = req.body;

  if (!name || !name.trim()) return res.status(400).json({ error: "name is required" });
  if (!workingDirectory) return res.status(400).json({ error: "workingDirectory is required" });
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: "prompt is required" });
```
With:
```javascript
  const { name, cronExpression, workingDirectory, prompt, model, emails, kind, workflowSource } = req.body;
  const isWorkflow = kind === "workflow";

  if (!name || !name.trim()) return res.status(400).json({ error: "name is required" });
  if (!workingDirectory) return res.status(400).json({ error: "workingDirectory is required" });
  if (!isWorkflow && (!prompt || !prompt.trim())) return res.status(400).json({ error: "prompt is required" });
  if (isWorkflow) {
    const profileId2 = req.profile?.id || null;
    const { dsl, error } = parseWorkflowSource(workflowSource || "");
    if (error) return res.status(400).json({ error: `Invalid workflow: ${error}` });
    const ids = listAllTasks(profileId2).filter((t) => t.kind !== "workflow").map((t) => t.id);
    const { valid, errors } = validateWorkflow(dsl, ids);
    if (!valid) return res.status(400).json({ error: `Invalid workflow: ${errors.map((e) => e.message).join("; ")}` });
  }
```
And change the `createTask` call to pass the fields:
```javascript
  const task = createTask(profileId, { name: name.trim(), cronExpression: cronExpression || null, workingDirectory, prompt: (prompt || "").trim(), model: model || null, emails: emails || [], webhookBaseUrl, kind: isWorkflow ? "workflow" : "task", workflowSource: isWorkflow ? workflowSource : null });
```

In `app.put("/api/tasks/:id", ...)`: after the cron/workingDirectory validation and before `updateTaskData(...)`, add workflow validation:
```javascript
  if (req.body.kind === "workflow" || (req.body.kind === undefined && task.kind === "workflow")) {
    const src = req.body.workflowSource !== undefined ? req.body.workflowSource : task.workflowSource;
    const { dsl, error } = parseWorkflowSource(src || "");
    if (error) return res.status(400).json({ error: `Invalid workflow: ${error}` });
    const ids = listAllTasks(req.profile?.id || null).filter((t) => t.kind !== "workflow" && t.id !== task.id).map((t) => t.id);
    const { valid, errors } = validateWorkflow(dsl, ids);
    if (!valid) return res.status(400).json({ error: `Invalid workflow: ${errors.map((e) => e.message).join("; ")}` });
  }
```

- [ ] **Step 4: Dispatch workflows on trigger and webhook**

In `app.post("/api/tasks/:id/trigger", ...)`, replace the body with kind-aware dispatch:
```javascript
app.post("/api/tasks/:id/trigger", (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  if (isRunning(req.params.id)) return res.status(409).json({ error: "Task is already running" });
  if (task.kind === "workflow") {
    const result = triggerWorkflow(req.params.id);
    if (!result) return res.status(409).json({ error: "Could not start workflow" });
    return res.json({ ok: true, message: "Workflow triggered", runId: result.runId });
  }
  const result = triggerTask(req.params.id);
  if (!result) return res.status(409).json({ error: "Task is already running" });
  const baseUrl = `${BASE_URL_PROTOCOL}://${req.get("host")}`;
  const summaryUrl = `${baseUrl}/api/tasks/${req.params.id}/runs/${result.runId}/summary`;
  res.json({ ok: true, message: "Task triggered", runId: result.runId, summaryUrl, summaryFilename: result.summaryFilename });
});
```

In the webhook handler `app.post("/api/webhooks/tasks/:taskId/:token", ...)` (near line 449), replace the `triggerTask(...)` dispatch with:
```javascript
  const result = task.kind === "workflow"
    ? triggerWorkflow(taskId, payload ? { payload } : undefined)
    : triggerTask(taskId, payload ? { payload } : undefined);
```
(Leave the summary URL construction; for workflows `summaryFilename` will be undefined, which is acceptable.)

- [ ] **Step 5: Dispatch workflows in the scheduler tick**

In `app/server/tasks.js`, import the engine lazily to avoid a circular import. At the top of `tasks.js` add:
```javascript
import { executeWorkflow } from "./workflow-engine.js";
```
Wait — `workflow-engine.js` imports from `tasks.js`, creating a cycle. ESM handles cycles if usage is deferred to call time. `executeWorkflow` is only *called* inside `tick()` (runtime), not at module-eval time, so the cycle is safe. Modify `tick()`:
```javascript
function tick() {
  const now = Date.now();
  for (const [id, task] of tasks) {
    if (!task.enabled) continue;
    if (!task.cronExpression) continue;
    if (runningJobs.has(id)) continue;
    if (task.nextRunAt && task.nextRunAt <= now) {
      if (task.kind === "workflow") executeWorkflow(id);
      else executeTask(id);
    }
  }
}
```

- [ ] **Step 6: Smoke-test the server boots**

Run: `cd app && node -e "import('./server/workflow-engine.js').then(()=>import('./server/tasks.js')).then(()=>console.log('modules load OK')).catch(e=>{console.error(e);process.exit(1)})"`
Expected: prints `modules load OK` (verifies no circular-import eval failure).

- [ ] **Step 7: Run full suite**

Run: `cd app && node --test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/server/authoring.js app/server/index.js app/server/tasks.js
git commit -m "feat: wire workflow validation, authoring, and dispatch endpoints"
```

---

## Task 5: Client — kind toggle, DSL editor, live validation + read-only graph

**Files:**
- Create: `app/client/src/lib/workflowGraph.js`
- Create: `app/client/src/components/WorkflowGraph.jsx`
- Modify: `app/client/src/components/TaskForm.jsx`
- Modify: `app/client/src/hooks/useTasks.js`

- [ ] **Step 1: Layout helper**

Create `app/client/src/lib/workflowGraph.js`:

```javascript
// Assign simple layered (x,y) coordinates to graph nodes via BFS from start.
// Pure function; input is { nodes, edges } from the server buildGraph output.
export function layoutGraph(graph, startId) {
  const COL_W = 220, ROW_H = 90, PAD = 20;
  const adjacency = new Map();
  for (const n of graph.nodes) adjacency.set(n.id, []);
  for (const e of graph.edges) {
    if (adjacency.has(e.from)) adjacency.get(e.from).push(e.to);
  }
  const depth = new Map();
  const queue = [];
  const start = startId && adjacency.has(startId) ? startId : graph.nodes[0]?.id;
  if (start) { depth.set(start, 0); queue.push(start); }
  while (queue.length) {
    const id = queue.shift();
    const d = depth.get(id);
    for (const to of adjacency.get(id) || []) {
      if (!depth.has(to)) { depth.set(to, d + 1); queue.push(to); }
    }
  }
  // Nodes unreachable from start get appended at the end.
  let maxDepth = 0;
  for (const v of depth.values()) maxDepth = Math.max(maxDepth, v);
  const perLevel = new Map();
  const positioned = graph.nodes.map((n) => {
    const d = depth.has(n.id) ? depth.get(n.id) : maxDepth + 1;
    const row = perLevel.get(d) || 0;
    perLevel.set(d, row + 1);
    return { ...n, x: PAD + d * COL_W, y: PAD + row * ROW_H, col: d, row };
  });
  const width = PAD * 2 + (Math.max(maxDepth + 1, 1)) * COL_W;
  let maxRows = 0;
  for (const r of perLevel.values()) maxRows = Math.max(maxRows, r);
  const height = PAD * 2 + Math.max(maxRows, 1) * ROW_H;
  return { nodes: positioned, edges: graph.edges, width, height };
}
```

- [ ] **Step 2: Read-only graph component**

Create `app/client/src/components/WorkflowGraph.jsx`:

```jsx
import { layoutGraph } from "@/lib/workflowGraph";

const TYPE_COLORS = {
  task: "#2563eb",
  decision: "#d97706",
  fork: "#7c3aed",
  join: "#7c3aed",
  unknown: "#6b7280",
};
const STATUS_COLORS = {
  pending: "#9ca3af",
  running: "#2563eb",
  success: "#16a34a",
  error: "#dc2626",
  skipped: "#d1d5db",
};

export default function WorkflowGraph({ graph, startId, nodeState }) {
  if (!graph || !graph.nodes?.length) {
    return <p className="text-xs text-muted-foreground">No nodes to display.</p>;
  }
  const laid = layoutGraph(graph, startId);
  const NW = 160, NH = 48;
  const byId = Object.fromEntries(laid.nodes.map((n) => [n.id, n]));

  return (
    <svg width={laid.width} height={laid.height} className="max-w-full">
      {laid.edges.map((e, i) => {
        const a = byId[e.from], b = byId[e.to];
        if (!a || !b) return null;
        const x1 = a.x + NW, y1 = a.y + NH / 2;
        const x2 = b.x, y2 = b.y + NH / 2;
        return (
          <g key={i}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#9ca3af" strokeWidth="1.5"
              strokeDasharray={e.kind === "join-hint" ? "4 3" : undefined} />
            {e.label ? (
              <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 4} fontSize="10" fill="#6b7280" textAnchor="middle">
                {e.label.length > 22 ? e.label.slice(0, 22) + "…" : e.label}
              </text>
            ) : null}
          </g>
        );
      })}
      {laid.nodes.map((n) => {
        const st = nodeState?.[n.id]?.status;
        const border = st ? STATUS_COLORS[st] : (n.errors?.length ? "#dc2626" : TYPE_COLORS[n.type]);
        return (
          <g key={n.id}>
            <rect x={n.x} y={n.y} width={NW} height={NH} rx="6"
              fill="white" stroke={border} strokeWidth={n.errors?.length ? 2.5 : 1.5} />
            <text x={n.x + 8} y={n.y + 18} fontSize="11" fontWeight="600" fill="#111827">
              {n.label.length > 20 ? n.label.slice(0, 20) + "…" : n.label}
            </text>
            <text x={n.x + 8} y={n.y + 34} fontSize="9" fill={TYPE_COLORS[n.type]}>
              {n.type}{n.isStart ? " · start" : ""}{st ? ` · ${st}` : ""}
            </text>
            {n.errors?.length ? <title>{n.errors.join("\n")}</title> : null}
          </g>
        );
      })}
    </svg>
  );
}
```

- [ ] **Step 3: Hook passes new fields**

In `app/client/src/hooks/useTasks.js`, find where the create/update payloads are built and ensure `kind` and `workflowSource` are forwarded. Locate the function(s) that POST to `/api/tasks` and PUT to `/api/tasks/:id` and include those keys in the JSON body (spread the incoming form object so any added field flows through). Example (adapt to existing code):

```javascript
// when creating:
body: JSON.stringify(taskData),   // taskData already contains kind/workflowSource
```
Confirm the existing hook already spreads the form object; if it cherry-picks fields, add `kind: taskData.kind, workflowSource: taskData.workflowSource`.

- [ ] **Step 4: TaskForm — kind toggle + DSL editor + graph**

In `app/client/src/components/TaskForm.jsx`:

Add state near the other `useState` calls:
```javascript
  const [kind, setKind] = useState(initial?.kind === "workflow" ? "workflow" : "task");
  const [workflowSource, setWorkflowSource] = useState(initial?.workflowSource || "");
  const [wfValidation, setWfValidation] = useState(null); // { valid, errors, graph }
  const [showAuthoring, setShowAuthoring] = useState(false);
```

In the `useEffect` that resets the form on open, add:
```javascript
      setKind(initial?.kind === "workflow" ? "workflow" : "task");
      setWorkflowSource(initial?.workflowSource || "");
      setWfValidation(null);
```

Add a debounced workflow validation effect (after the cron effect):
```javascript
  useEffect(() => {
    if (kind !== "workflow" || !workflowSource.trim()) { setWfValidation(null); return; }
    const timer = setTimeout(() => {
      fetch("/api/tasks/validate-workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowSource }),
      })
        .then((r) => r.json())
        .then((data) => setWfValidation(data))
        .catch(() => setWfValidation(null));
    }, 400);
    return () => clearTimeout(timer);
  }, [kind, workflowSource]);
```

In `handleSubmit`, include the new fields in the `onSubmit` payload:
```javascript
        kind,
        workflowSource: kind === "workflow" ? workflowSource : null,
```
And relax prompt requirement: change the submit `disabled` condition so a workflow doesn't require `prompt`:
```javascript
          disabled={submitting || !name.trim() || !workingDirectory || (kind === "task" && !prompt.trim()) || !!cronError || invalidEmails.length > 0 || (kind === "workflow" && wfValidation && !wfValidation.valid)}
```

Add a kind toggle at the top of the left column (above Name), and swap the right column based on `kind`. Add this toggle block:
```jsx
              <div>
                <label className="text-xs text-muted-foreground font-medium">Type</label>
                <div className="flex gap-1 mt-1">
                  {["task", "workflow"].map((k) => (
                    <button key={k} type="button" onClick={() => setKind(k)}
                      className={cn("px-3 py-1 text-xs rounded-md border capitalize",
                        kind === k ? "bg-primary/20 text-primary border-primary/30"
                                   : "bg-muted text-muted-foreground border-transparent")}>
                      {k}
                    </button>
                  ))}
                </div>
              </div>
```

Replace the right column (the prompt `<div className="flex flex-col">...`) so that when `kind === "workflow"` it renders the DSL editor + graph + authoring button, else the existing prompt textarea + its authoring button:
```jsx
            {kind === "workflow" ? (
              <div className="flex flex-col">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground font-medium">Workflow Definition (JSON)</label>
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs"
                    onClick={() => setShowAuthoring(true)}>Author with AI</Button>
                </div>
                <textarea
                  value={workflowSource}
                  onChange={(e) => setWorkflowSource(e.target.value)}
                  placeholder='{ "name": "My Workflow", "start": "step1", "nodes": { ... } }'
                  className={cn(inputClass, "mt-1 min-h-[220px] resize-y font-mono text-xs")}
                />
                {wfValidation && !wfValidation.valid && (
                  <ul className="mt-2 text-[11px] text-destructive list-disc pl-4">
                    {wfValidation.errors.slice(0, 8).map((er, i) => (
                      <li key={i}>{er.nodeId ? `[${er.nodeId}] ` : ""}{er.message}</li>
                    ))}
                  </ul>
                )}
                {wfValidation?.graph && (
                  <div className="mt-3 border border-border rounded-md p-2 overflow-auto max-h-[320px]">
                    <WorkflowGraph graph={wfValidation.graph} startId={(() => { try { return JSON.parse(workflowSource).start; } catch { return null; } })()} />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground font-medium">Prompt</label>
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs"
                    onClick={() => setShowAuthoring(true)}>Author with AI</Button>
                </div>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={"e.g., Review all open PRs in this repository."}
                  className={cn(inputClass, "mt-1 flex-1 min-h-[320px] resize-y")}
                />
                <p className="text-[11px] text-muted-foreground/60 mt-1">
                  This prompt will be sent to a fresh Claude agent each time the task runs.
                </p>
              </div>
            )}
```

Add imports at the top:
```javascript
import WorkflowGraph from "@/components/WorkflowGraph";
import AuthoringDialog from "@/components/AuthoringDialog";
```

Render the authoring dialog before the closing `</Dialog>`:
```jsx
        <AuthoringDialog
          open={showAuthoring}
          onClose={() => setShowAuthoring(false)}
          mode={kind}
          currentDraft={kind === "workflow" ? workflowSource : prompt}
          onApply={(draft) => { if (kind === "workflow") setWorkflowSource(draft); else setPrompt(draft); }}
        />
```

- [ ] **Step 5: Manual verification**

Run the app (`cd app && npm run dev:server` and `npm run dev:client` per existing workflow), open New Task, toggle to **Workflow**, paste a small DSL, and confirm: validation errors list updates live; the graph renders nodes/edges; invalid taskId shows a red node; saving a valid workflow succeeds and an invalid one is rejected by the server.

- [ ] **Step 6: Commit**

```bash
git add app/client/src/lib/workflowGraph.js app/client/src/components/WorkflowGraph.jsx app/client/src/components/TaskForm.jsx app/client/src/hooks/useTasks.js
git commit -m "feat: workflow editor with live validation and read-only graph"
```

---

## Task 6: Client — AI authoring dialog

**Files:**
- Create: `app/client/src/components/AuthoringDialog.jsx`

- [ ] **Step 1: Implement the dialog**

Create `app/client/src/components/AuthoringDialog.jsx`:

```jsx
import { useState, useEffect } from "react";
import { Loader2, Sparkles, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// Extract the last fenced code block from assistant text.
function extractDraft(text) {
  const re = /```(?:json|yaml|text)?\s*\n([\s\S]*?)```/g;
  let last = null, m;
  while ((m = re.exec(text)) !== null) last = m[1];
  return last ? last.trim() : null;
}

export default function AuthoringDialog({ open, onClose, mode, currentDraft, onApply }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setMessages([]);
      setInput("");
    }
  }, [open]);

  async function send() {
    if (!input.trim() || busy) return;
    const next = [...messages, { role: "user", content: input.trim() }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const seeded = currentDraft
        ? [{ role: "user", content: `Current draft:\n\n${currentDraft}` }, ...next]
        : next;
      const r = await fetch("/api/tasks/author-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, messages: seeded }),
      });
      const data = await r.json();
      setMessages([...next, { role: "assistant", content: data.reply || data.error || "(no reply)" }]);
    } catch (err) {
      setMessages([...next, { role: "assistant", content: `Error: ${err.message}` }]);
    } finally {
      setBusy(false);
    }
  }

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const draft = lastAssistant ? extractDraft(lastAssistant.content) : null;

  return (
    <Dialog open={open} onClose={onClose} className="max-w-2xl w-full h-[80vh] overflow-hidden">
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border shrink-0">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Author {mode === "workflow" ? "Workflow" : "Prompt"} with AI</h3>
          <div className="flex-1" />
          <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={onClose}>Close</Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {messages.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Describe what you want. {mode === "workflow"
                ? "The assistant knows the workflow DSL and your available tasks."
                : "The assistant will draft an effective task prompt."}
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={cn("text-sm whitespace-pre-wrap rounded-md px-3 py-2",
              m.role === "user" ? "bg-muted" : "bg-primary/5 border border-primary/10")}>
              <span className="text-[10px] uppercase text-muted-foreground block mb-1">{m.role}</span>
              {m.content}
            </div>
          ))}
          {busy && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Thinking…</div>}
        </div>

        <div className="border-t border-border px-5 py-3 shrink-0 space-y-2">
          {draft && (
            <Button type="button" size="sm" className="w-full h-8 text-xs"
              onClick={() => { onApply(draft); onClose(); }}>
              <Check className="h-3 w-3 mr-1" /> Apply to editor
            </Button>
          )}
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }}
              placeholder="Describe the task or workflow… (Cmd/Ctrl+Enter to send)"
              className="flex-1 px-3 py-2 text-sm rounded-md border border-input bg-background resize-none h-16"
            />
            <Button type="button" onClick={send} disabled={busy || !input.trim()}>Send</Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
```

- [ ] **Step 2: Manual verification**

Open the task editor, click **Author with AI**, ask for a prompt or workflow, confirm a reply renders, the **Apply to editor** button appears when the reply contains a fenced block, and clicking it fills the editor (and triggers live validation in workflow mode).

- [ ] **Step 3: Commit**

```bash
git add app/client/src/components/AuthoringDialog.jsx
git commit -m "feat: AI-assisted authoring dialog for prompts and workflows"
```

---

## Task 7: Client — workflow run rendering in TaskDetail

**Files:**
- Modify: `app/client/src/components/TaskDetail.jsx`

- [ ] **Step 1: Inspect how run detail is fetched/rendered**

Open `app/client/src/components/TaskDetail.jsx` and locate where a run's detail (`/api/tasks/:id/runs/:runId`) is shown. Workflow runs include `nodeState` and `dsl` in the detail payload (added by the engine's `recordRun`).

- [ ] **Step 2: Render the workflow run graph**

Where a run detail is displayed, add a branch: if `detail.workflow` and `detail.dsl`, build a graph client-side and render statuses. Add an import:
```javascript
import WorkflowGraph from "@/components/WorkflowGraph";
import { buildGraphFromDsl } from "@/lib/workflowGraphClient";
```
Create `app/client/src/lib/workflowGraphClient.js` (a client mirror of `buildGraph` minus error attachment, since runs are already validated):
```javascript
export function buildGraphFromDsl(dsl) {
  const nodes = [], edges = [];
  const raw = dsl?.nodes || {};
  for (const [id, node] of Object.entries(raw)) {
    nodes.push({ id, type: node?.type || "unknown", taskId: node?.taskId || null, label: id, isStart: dsl?.start === id, errors: [] });
    if (!node) continue;
    if (node.type === "task" || node.type === "join") { if (node.next) edges.push({ from: id, to: node.next, label: "" }); }
    else if (node.type === "decision" && Array.isArray(node.edges)) node.edges.forEach((e) => e?.next && edges.push({ from: id, to: e.next, label: e.condition || "" }));
    else if (node.type === "fork" && Array.isArray(node.branches)) {
      node.branches.forEach((b) => edges.push({ from: id, to: b, label: "", kind: "fork" }));
      if (node.join) edges.push({ from: id, to: node.join, label: "join", kind: "join-hint" });
    }
  }
  return { nodes, edges, globalErrors: [] };
}
```
Then render (inside the run detail view):
```jsx
{runDetail?.workflow && runDetail?.dsl && (
  <div className="border border-border rounded-md p-2 overflow-auto">
    <WorkflowGraph
      graph={buildGraphFromDsl(runDetail.dsl)}
      startId={runDetail.dsl.start}
      nodeState={runDetail.nodeState}
    />
  </div>
)}
```
(Use the actual variable name TaskDetail uses for the loaded run detail in place of `runDetail`.)

- [ ] **Step 3: Manual verification**

Trigger a workflow task, open its latest run, and confirm the graph renders with node statuses colored (success green, error red) and the executed path visible.

- [ ] **Step 4: Commit**

```bash
git add app/client/src/components/TaskDetail.jsx app/client/src/lib/workflowGraphClient.js
git commit -m "feat: render workflow run graph with node statuses"
```

---

## Self-Review Notes

- **Spec coverage:** data model (Task 2), DSL (Task 1), engine incl. fork/join + decisions + fail-stop + max-step cap (Task 3), validation endpoint (Task 4), cron/webhook dispatch (Task 4), read-only graph + editor (Task 5), AI authoring dialog + endpoint (Tasks 4, 6), workflow run rendering (Task 7). All spec sections map to a task.
- **DSL format:** JSON instead of YAML (no new parser dep; Monaco-friendly). Structure identical to the approved design; this is the only deviation and is noted in the design doc's open-questions follow-up.
- **Type consistency:** `runTaskAsSubagent(task, payload, profileId, runId)` signature used identically in Tasks 2 and 3; `validateWorkflow(dsl, availableTaskIds)` and `buildGraph(dsl, errors)` consistent across Tasks 1/4; `nodeState`/`dsl` keys written by `recordRun` (Task 3) and read in Task 7.
- **Circular import:** `tasks.js` ↔ `workflow-engine.js` is import-time safe because cross-references are only invoked at call time; Task 4 Step 6 smoke-tests this.
