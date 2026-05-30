# Workflow Orchestration Design

## Overview

Add a workflow orchestration layer on top of the existing task system. A
**workflow** is a special kind of task that, instead of running a single prompt,
orchestrates several existing tasks as steps — passing each step's output to the
next, branching via AI-evaluated decisions, and running branches in parallel via
fork/join. The workflow task is a *shell*: all real work happens in ephemeral
subagents spawned per step. Workflows reuse the existing task configuration
(name, schedule, webhook, emails, model, working directory) and the same cron and
webhook triggers.

A secondary feature in this spec: an **AI-assisted authoring dialog** that helps
the user draft a task prompt or a workflow DSL via an interactive chat.

## Goals

- Define workflows as a structured, text-based DSL that supports decisions and
  fork/join.
- Reuse existing tasks as reusable "recipes" referenced by id.
- Flow each step's output into the next step.
- An AI decision node that routes execution down exactly one outgoing edge.
- Keep the existing trigger hooks (cron + webhook) working for workflows.
- A read-only graph rendering of the workflow with inline validation.
- An AI chat dialog that drafts prompts/DSL and applies the result to the editor.

## Non-Goals (v1)

- Visual drag-and-drop workflow editing (authoring is DSL text).
- Nesting a workflow inside another workflow.
- Continue-on-failure / per-node error policies (failure stops the run).
- Workspace-tool access for the authoring assistant (pure conversational drafter).

## Data Model

Workflows reuse the existing task object (stored in the same per-profile
`tasks.json`). Two new fields are added:

```javascript
{
  // ... all existing task fields (name, cronExpression, workingDirectory,
  //     prompt, model, emails, webhookToken, webhookBaseUrl, ...)
  kind: "task" | "workflow",   // default "task"; absent => "task" (back-compat)
  workflowSource: string | null // raw DSL (YAML) text; only for kind === "workflow"
}
```

Field semantics for `kind === "workflow"`:

- `prompt` is unused (or may hold an optional human description); execution is
  driven by `workflowSource`.
- `workingDirectory` is the *fallback* directory for the shell itself (e.g. the
  decision agent). Each step uses its **referenced task's** own
  `workingDirectory`, `prompt`, and `model`.
- `cronExpression`, `webhookToken`, `emails` keep their existing meaning and
  trigger the workflow.

Back-compat: existing tasks have no `kind` field and are treated as
`kind: "task"`. No migration required.

## The DSL

A workflow is a structured document describing a directed graph of nodes. Four
node types: `task`, `decision`, `fork`, `join`. `next: null` ends the workflow.

> **Implementation note:** the on-disk/wire format is **JSON** (not YAML). This
> avoids adding a YAML parser to both the server and the browser bundle, and lets
> the editor lean on Monaco's native JSON support. The structure below is shown
> in YAML for readability; the equivalent JSON is what `workflowSource` stores.

```yaml
name: Security sweep
start: scan
nodes:
  scan:                       # task node — runs an existing task
    type: task
    taskId: 4f3c-...          # references an existing task in this profile
    next: route

  route:                      # decision node — AI picks exactly ONE edge
    type: decision
    prompt: "Based on the scan result, choose the path."
    edges:
      - condition: "the scan found vulnerabilities"
        next: fix_out
      - condition: "the scan is clean"
        next: notify

  fix_out:                    # fork node — fan out concurrently
    type: fork
    branches: [patch_code, file_issue]
    join: merged

  patch_code: { type: task, taskId: aaa-..., next: merged }
  file_issue: { type: task, taskId: bbb-..., next: merged }

  merged:                     # join node — waits for all branches, merges output
    type: join
    next: notify

  notify: { type: task, taskId: ccc-..., next: null }   # null => end
```

### Node types

- **task**: `{ type, taskId, next }`. Spawns a subagent from the referenced
  task's config; its output is the subagent's summary text.
- **decision**: `{ type, prompt, edges: [{ condition, next }, ...] }`. An AI call
  evaluates the incoming output against each edge `condition` and selects exactly
  one `next`. Single path forward.
- **fork**: `{ type, branches: [nodeId, ...], join: nodeId }`. Starts each branch
  entry node concurrently. Branches must converge on the declared `join`.
- **join**: `{ type, next }`. Waits for all branches of its matching fork to
  finish, merges their outputs, then continues.

### Data flow

- Every node produces a text output. For a `task` node this is the referenced
  task's `summary.md` content (same artifact tasks already produce).
- A node receives its predecessor's output injected as the `payload` — the exact
  mechanism the webhook already uses (`prompt + "\n\n" + payload`).
- After a `join`, the payload is the concatenation of all branch outputs (each
  labeled with its branch node id).
- The workflow's own initial trigger `payload` (from a webhook) is injected into
  the `start` node.
- A `decision` node receives the incoming output as context plus the list of edge
  conditions; the AI returns the chosen edge.

### Cycles

A decision edge may point back to an upstream node ("loop until"). Cycles are
allowed but guarded by a **max-step safety cap** per run (configurable constant,
e.g. 100 node executions) after which the run errors out.

## Execution Engine (`app/server/workflows.js`)

New module mirroring `tasks.js` structure. Key export:
`executeWorkflow(taskId, { payload, runId })`.

### Shared subagent helper

Refactor the agent-spawn/send/collect logic currently inline in
`tasks.js#executeTask` into a shared helper:

```
runTaskAsSubagent(taskConfig, payload, profileId) ->
  { outputText, conversation, cost, usage, summaryPath }
```

It performs: `createAgent` in `taskConfig.workingDirectory`, disable interactive
questions, apply model override, subscribe listener, `sendMessage(prompt +
payload + SUMMARY_INSTRUCTION)`, collect assistant text, persist `summary.md`,
`deleteAgent`. Both `executeTask` (existing path) and the workflow engine use it.
This removes the `taskId` run-lock for workflow steps, so the same task can run
in multiple branches concurrently.

### Walk algorithm

- Parse `workflowSource`; if invalid, fail the run immediately.
- Maintain run state: `nodeId -> { status, output, startedAt, completedAt, error }`
  where `status ∈ pending | running | success | error | skipped`.
- Begin at `start` with the trigger payload.
- **task node**: `runTaskAsSubagent(referencedTask, incomingPayload, profileId)`;
  store output; advance to `next`.
- **decision node**: one constrained AI call (lightweight model) given the
  decision `prompt`, incoming output, and enumerated edge conditions; it must
  return exactly one edge index/label. If it cannot, the run errors. Advance down
  the chosen edge; mark the not-taken edges' subtrees `skipped` for rendering.
- **fork node**: launch each branch entry node concurrently (`Promise.all`),
  bounded by a concurrency cap (constant, e.g. 4). Each branch walks its chain
  until it reaches the fork's `join`.
- **join node**: once all branches arrive, merge their outputs (labeled
  concatenation) and advance to `next`.
- Terminate when reaching a `next: null` or when no further nodes remain.

### Error handling

If any task step or any fork branch errors, the workflow run stops and is
recorded as `error` (no continue-on-failure in v1). If the decision AI cannot
return a listed edge, the run errors.

### Persistence

Workflow runs reuse the existing task run-history machinery (run entries + run
detail files under `task-runs/<taskId>/`). The run detail additionally stores the
full node-state map and the chosen path so the run view can render the executed
graph. The top-level `resultSummary` for a workflow run is the output of its
terminal node(s).

### Triggering

`tasks.js#tick()` and the webhook endpoint dispatch on `kind`:
`kind === "workflow"` -> `executeWorkflow`, else `executeTask`. The existing
"already running" guard applies per workflow task id. Cron `nextRunAt`
computation is unchanged.

## Validation (`app/shared` or duplicated validator usable by client + server)

A pure JS validator `validateWorkflow(dsl, availableTaskIds) -> { errors: [...] }`
runs both server-side on save and client-side live (for the read-only graph).

Rules:

- `start` is present and refers to an existing node.
- Every `next` and every edge `next` target refers to an existing node.
- Every `task` node's `taskId` exists in the profile's task list (and is not
  itself a workflow — no nesting in v1).
- Every `decision` node has at least one edge and every edge has a non-empty
  `condition` and a `next`.
- Every `fork` has `>= 2` branches and a `join` that exists and is of type `join`;
  each listed branch must reach that join.
- Node ids are unique; node `type` is one of the four known types.
- (Warning, non-blocking) unreachable nodes from `start`.

Server rejects save with `400` and the error list if validation fails for a
`kind: "workflow"` task.

## UI

### Task editor (`TaskForm.jsx`)

- Add a `kind` toggle (Task / Workflow). When **Workflow**:
  - Replace the prompt textarea with a YAML DSL editor (monospace textarea; the
    repo already has a `CodeEditor` component that can be reused).
  - Render a **read-only graph** below the editor: nodes (task/decision/fork/join)
    and edges, re-rendered live as the DSL changes, with inline validation badges
    (red node = unknown taskId / dangling edge / fork without join, etc.).
  - The cron/webhook/emails/model fields remain as-is.
- When **Task** (default): the form is unchanged.

Graph rendering can use a lightweight layout (e.g. a simple layered/columnar SVG
renderer, or a small dependency). It is read-only — no node dragging or editing.

### Run detail (workflow runs)

The workflow run view shows the same graph with per-node status coloring
(pending / running / success / error / skipped) and the AI-chosen path
highlighted. Clicking a node shows that node's output (the subagent summary) and
timing. Standalone-task run views are unchanged.

## AI-Assisted Authoring Dialog

An interactive chat that drafts a task prompt or a workflow DSL.

### UI

- An **"Author with AI"** button beside the prompt textarea (task mode) and beside
  the DSL editor (workflow mode).
- Opens a side dialog with a back-and-forth chat (reuse existing chat UI
  components where possible).
- The assistant proposes a draft inside a fenced code block. An **"Apply to
  editor"** button extracts the latest draft and writes it into the field, which
  remains hand-editable. On apply, live validation runs (DSL validation in
  workflow mode).

### Assistant behavior

- Pure conversational drafter — **no workspace tools**.
- Mode-aware system context:
  - *Prompt mode*: guidance for writing an effective single-task prompt.
  - *Workflow mode*: system context is preloaded with the **DSL reference/spec**
    and the profile's **available task list** (id, name, prompt snippet,
    workingDirectory), so the assistant emits valid DSL referencing real
    `taskId`s.

### Backend

- New endpoint `POST /api/tasks/author-assistant` taking
  `{ mode: "prompt" | "workflow", messages: [...], currentDraft }`.
- Injects the appropriate system context (and, for workflow mode, the live task
  list for the requesting profile) and returns the assistant's turn.
- Reuses the existing agent SDK (a lightweight ephemeral agent or a direct SDK
  query); the draft is extracted client-side from the assistant's fenced code
  block on Apply.

## Files Touched (anticipated)

Server:

- `app/server/workflows.js` (new) — engine, walk, validation entry.
- `app/server/tasks.js` — extract `runTaskAsSubagent`; add `kind`/`workflowSource`
  to CRUD; dispatch in `tick()`.
- `app/server/index.js` — workflow validation on save; webhook dispatch on `kind`;
  `author-assistant` endpoint.
- A shared `validateWorkflow` validator usable by client and server.

Client:

- `app/client/src/components/TaskForm.jsx` — kind toggle, DSL editor, graph.
- New components: workflow graph renderer (read-only), AI authoring dialog.
- `app/client/src/components/TaskDetail.jsx` / run views — workflow run rendering.
- `app/client/src/hooks/useTasks.js` — carry `kind` / `workflowSource`.

## Open Questions / Confirmed Defaults

- **Error handling**: fail-stop on any step/branch error (confirmed).
- **Decision determinism**: AI must return exactly one listed edge or the run
  errors (confirmed).
- **Spec location**: this doc lives in `docs/plans/` to match the existing repo
  convention (`2026-03-09-task-webhooks-design.md`).
