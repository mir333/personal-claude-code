# Task Webhooks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow tasks to be triggered via HTTP webhook with a per-task secret token and optional payload injection.

**Architecture:** Add a `webhookToken` field to tasks, a public webhook endpoint mounted before the auth middleware, and authenticated endpoints to manage tokens. The webhook payload (any content type) is appended to the task prompt as a context block. UI gets a webhook section in TaskDetail.

**Tech Stack:** Express.js (server), React (client), crypto for token generation and timing-safe comparison.

---

### Task 1: Add webhookToken to task data model

**Files:**
- Modify: `app/server/tasks.js:166-187` (createTask)
- Modify: `app/server/tasks.js:203-224` (updateTask)

**Step 1: Add webhookToken field to createTask**

In `app/server/tasks.js`, in the `createTask` function (line 170), add `webhookToken: null` to the task object:

```javascript
const task = {
    id,
    profileId,
    name: config.name,
    enabled: hasCron,
    cronExpression: config.cronExpression || null,
    workingDirectory: config.workingDirectory,
    prompt: config.prompt,
    webhookToken: null,
    createdAt: now,
    updatedAt: now,
    lastRunAt: null,
    lastRunStatus: null,
    nextRunAt: hasCron ? computeNextRun(config.cronExpression) : null,
  };
```

**Step 2: Add webhook token management functions**

Add these three exported functions after `toggleTask` (after line ~255) in `app/server/tasks.js`:

```javascript
export function generateWebhookToken(taskId) {
  const task = tasks.get(taskId);
  if (!task) return null;
  task.webhookToken = crypto.randomBytes(32).toString("hex");
  task.updatedAt = Date.now();
  tasks.set(taskId, task);
  persistTasks(task.profileId);
  return task.webhookToken;
}

export function revokeWebhookToken(taskId) {
  const task = tasks.get(taskId);
  if (!task) return false;
  task.webhookToken = null;
  task.updatedAt = Date.now();
  tasks.set(taskId, task);
  persistTasks(task.profileId);
  return true;
}

export function getTaskByWebhookToken(taskId, token) {
  const task = tasks.get(taskId);
  if (!task || !task.webhookToken) return null;
  // Timing-safe comparison
  const expected = Buffer.from(task.webhookToken, "utf-8");
  const received = Buffer.from(token, "utf-8");
  if (expected.length !== received.length) return null;
  if (!crypto.timingSafeEqual(expected, received)) return null;
  return task;
}
```

**Step 3: Modify executeTask to accept optional payload**

In `app/server/tasks.js`, change the `executeTask` signature (line 296) and prompt construction:

Change line 296 from:
```javascript
export async function executeTask(taskId) {
```
to:
```javascript
export async function executeTask(taskId, { payload } = {}) {
```

Change line 330 from:
```javascript
    await sendMessage(agent.id, task.prompt);
```
to:
```javascript
    let prompt = task.prompt;
    if (payload) {
      prompt += `\n\n---\nThe following payload was received via webhook:\n${payload}\n---`;
    }
    await sendMessage(agent.id, prompt);
```

**Step 4: Modify triggerTask to pass options through**

Change `triggerTask` (line 426) from:
```javascript
export function triggerTask(taskId) {
  const task = tasks.get(taskId);
  if (!task) return false;
  if (runningJobs.has(taskId)) return false;
  executeTask(taskId);
  return true;
}
```
to:
```javascript
export function triggerTask(taskId, opts) {
  const task = tasks.get(taskId);
  if (!task) return false;
  if (runningJobs.has(taskId)) return false;
  executeTask(taskId, opts);
  return true;
}
```

**Step 5: Commit**

```bash
git add app/server/tasks.js
git commit -m "feat: add webhookToken field and payload support to task model"
```

---

### Task 2: Add webhook API endpoints (server)

**Files:**
- Modify: `app/server/index.js:840-965` (task routes section)

**Step 1: Add imports**

In `app/server/index.js`, update the task imports (line 845) to also import the new functions:

```javascript
import {
  createTask,
  listTasks as listAllTasks,
  getTask,
  updateTask as updateTaskData,
  deleteTask as deleteTaskData,
  toggleTask,
  triggerTask,
  isRunning,
  getRunHistory,
  getRunDetail,
  getAllRuns,
  validateCron,
  getNextRuns,
  startTaskScheduler,
  onRunComplete,
  generateWebhookToken,
  revokeWebhookToken,
  getTaskByWebhookToken,
} from "./tasks.js";
```

**Step 2: Add public webhook endpoint BEFORE requireAuth**

This is critical — the webhook endpoint must be mounted before line 222 (`app.use("/api", requireAuth)`). Add it just before the auth guard middleware block (after the auth check endpoint, around line 206):

```javascript
// --- Public webhook endpoint (no session auth, token-validated) ---
app.post("/api/webhooks/tasks/:taskId/:token", express.text({ type: "*/*", limit: "100kb" }), (req, res) => {
  const { taskId, token } = req.params;
  const task = getTaskByWebhookToken(taskId, token);
  if (!task) return res.status(404).json({ error: "Not found" });
  if (isRunning(taskId)) return res.status(409).json({ error: "Task is already running" });

  const payload = req.body && typeof req.body === "string" && req.body.trim() ? req.body : null;
  const triggered = triggerTask(taskId, payload ? { payload } : undefined);
  if (!triggered) return res.status(409).json({ error: "Task is already running" });
  res.json({ ok: true, message: "Task triggered via webhook" });
});
```

Note: We use `express.text({ type: "*/*", limit: "100kb" })` as route-level middleware to read any content type as raw text.

**Step 3: Add authenticated webhook token management endpoints**

Add these after the existing task routes (after the validate-cron endpoint around line 965), inside the authenticated section:

```javascript
// Webhook token management
app.post("/api/tasks/:id/webhook-token", (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  const token = generateWebhookToken(req.params.id);
  const webhookUrl = `${req.protocol}://${req.get("host")}/api/webhooks/tasks/${req.params.id}/${token}`;
  res.json({ webhookToken: token, webhookUrl });
});

app.delete("/api/tasks/:id/webhook-token", (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  revokeWebhookToken(req.params.id);
  res.status(204).end();
});
```

**Step 4: Commit**

```bash
git add app/server/index.js
git commit -m "feat: add webhook endpoint and token management routes"
```

---

### Task 3: Add client-side webhook API functions

**Files:**
- Modify: `app/client/src/hooks/useTasks.js`

**Step 1: Add webhook functions to useTasks hook**

Add these two functions before the `return` statement (before line 101):

```javascript
const generateWebhookToken = useCallback(async (id) => {
  const res = await fetch(`/api/tasks/${id}/webhook-token`, { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to generate webhook token");
  setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, webhookToken: data.webhookToken } : t)));
  return data;
}, []);

const revokeWebhookToken = useCallback(async (id) => {
  const res = await fetch(`/api/tasks/${id}/webhook-token`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to revoke webhook token");
  }
  setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, webhookToken: null } : t)));
}, []);
```

**Step 2: Add to return object**

Add `generateWebhookToken` and `revokeWebhookToken` to the return object (line 101):

```javascript
return {
    tasks,
    loading,
    fetchTasks,
    createTask,
    updateTask,
    deleteTask,
    toggleTask,
    triggerTask,
    fetchRuns,
    fetchRunDetail,
    fetchAllRuns,
    validateCron,
    setTasks,
    generateWebhookToken,
    revokeWebhookToken,
  };
```

**Step 3: Commit**

```bash
git add app/client/src/hooks/useTasks.js
git commit -m "feat: add webhook token API functions to useTasks hook"
```

---

### Task 4: Add webhook UI to TaskDetail component

**Files:**
- Modify: `app/client/src/components/TaskDetail.jsx`
- Modify: `app/client/src/components/TasksPage.jsx`

**Step 1: Thread webhook functions through TasksPage**

In `app/client/src/components/TasksPage.jsx`, destructure the new functions from useTasks (around line 15):

Add `generateWebhookToken` and `revokeWebhookToken` to the destructuring at line 15-28.

Pass them to `TaskDetail` as props (around line 151):

```jsx
<TaskDetail
  task={selectedTask}
  onBack={handleBackToList}
  onEdit={handleEdit}
  onDelete={deleteTask}
  onToggle={handleToggle}
  onTrigger={triggerTask}
  onViewRun={handleViewRun}
  fetchRuns={fetchRuns}
  onGenerateWebhookToken={generateWebhookToken}
  onRevokeWebhookToken={revokeWebhookToken}
/>
```

**Step 2: Add webhook section to TaskDetail**

In `app/client/src/components/TaskDetail.jsx`:

1. Add imports: `Link, Copy, CopyCheck, RefreshCw, Webhook` from lucide-react (add `Globe, Copy, CopyCheck, RefreshCw` to the existing import).

2. Accept new props in the component signature (line 22):

```javascript
export default function TaskDetail({
  task,
  onBack,
  onEdit,
  onDelete,
  onToggle,
  onTrigger,
  onViewRun,
  fetchRuns,
  onGenerateWebhookToken,
  onRevokeWebhookToken,
}) {
```

3. Add state for webhook management (after line 34):

```javascript
const [webhookUrl, setWebhookUrl] = useState(null);
const [webhookCopied, setWebhookCopied] = useState(false);
const [webhookLoading, setWebhookLoading] = useState(false);
```

4. Add webhook handlers (after the handleDelete function, around line 73):

```javascript
async function handleGenerateToken() {
  setWebhookLoading(true);
  try {
    const data = await onGenerateWebhookToken(task.id);
    setWebhookUrl(data.webhookUrl);
  } catch (err) {
    alert(err.message || "Failed to generate webhook URL");
  } finally {
    setWebhookLoading(false);
  }
}

async function handleRevokeToken() {
  if (!confirm("Revoke webhook URL? Any integrations using it will stop working.")) return;
  setWebhookLoading(true);
  try {
    await onRevokeWebhookToken(task.id);
    setWebhookUrl(null);
  } catch (err) {
    alert(err.message || "Failed to revoke webhook");
  } finally {
    setWebhookLoading(false);
  }
}

function handleCopyWebhookUrl() {
  if (!webhookUrl) return;
  navigator.clipboard.writeText(webhookUrl);
  setWebhookCopied(true);
  setTimeout(() => setWebhookCopied(false), 1500);
}
```

5. Add the webhook UI section after the prompt preview section and before the action buttons (between line 145 and 148). Insert after the closing `</div>` of the prompt preview block:

```jsx
{/* Webhook section */}
<div className="pl-10">
  <p className="text-[11px] text-muted-foreground/60 mb-1">Webhook:</p>
  {task.webhookToken ? (
    <div className="space-y-1.5">
      {webhookUrl ? (
        <div className="flex items-center gap-2">
          <code className="text-[11px] bg-muted/50 rounded px-2 py-1 border border-border/50 truncate flex-1 select-all">
            {webhookUrl}
          </code>
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={handleCopyWebhookUrl}>
            {webhookCopied ? <CopyCheck className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
          </Button>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Webhook enabled — <button className="underline hover:text-foreground" onClick={handleGenerateToken}>show URL</button>
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="text-xs h-6"
          onClick={handleGenerateToken}
          disabled={webhookLoading}
        >
          <RefreshCw className={cn("h-3 w-3 mr-1", webhookLoading && "animate-spin")} />
          Regenerate
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-xs h-6 text-destructive hover:text-destructive"
          onClick={handleRevokeToken}
          disabled={webhookLoading}
        >
          Revoke
        </Button>
      </div>
    </div>
  ) : (
    <Button
      variant="outline"
      size="sm"
      className="text-xs h-6"
      onClick={handleGenerateToken}
      disabled={webhookLoading}
    >
      {webhookLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Globe className="h-3 w-3 mr-1" />}
      Enable Webhook
    </Button>
  )}
</div>
```

**Step 3: Commit**

```bash
git add app/client/src/components/TaskDetail.jsx app/client/src/components/TasksPage.jsx
git commit -m "feat: add webhook URL management UI to task detail view"
```

---

### Task 5: Build and verify

**Step 1: Build the client**

```bash
cd /workspace/miro/personal-claude-code/app/client && npm run build
```

Expected: Build succeeds with no errors.

**Step 2: Verify the server starts**

```bash
cd /workspace/miro/personal-claude-code && node app/server/index.js &
```

Check no startup errors.

**Step 3: Commit and push**

```bash
git push
```
