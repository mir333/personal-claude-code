import fs from "fs";
import path from "path";
import crypto from "crypto";
import cronParser from "cron-parser";
import { getProfilePaths, listProfiles } from "./profiles.js";
import {
  createAgent,
  sendMessage,
  deleteAgent,
  subscribeAgent,
  unsubscribeAgent,
} from "./agents.js";

// --- In-memory state ---
const tasks = new Map(); // taskId -> Task
const runningJobs = new Set(); // taskIds currently executing
let tickInterval = null;
const runCompleteListeners = new Set(); // Set of callback functions

// --- Storage paths ---

function getTasksDir(profileId) {
  return path.join("/home/node/.claude/profiles", profileId);
}

function getTasksPath(profileId) {
  return path.join(getTasksDir(profileId), "tasks.json");
}

function getRunsDir(profileId, taskId) {
  return path.join(getTasksDir(profileId), "task-runs", taskId);
}

function getRunsPath(profileId, taskId) {
  return path.join(getRunsDir(profileId, taskId), "runs.json");
}

function getRunDetailPath(profileId, taskId, runId) {
  return path.join(getRunsDir(profileId, taskId), `${runId}.json`);
}

// --- Storage helpers ---

function loadTasksFromDisk(profileId) {
  try {
    const data = JSON.parse(fs.readFileSync(getTasksPath(profileId), "utf-8"));
    return data.tasks || [];
  } catch {
    return [];
  }
}

function persistTasks(profileId) {
  const profileTasks = [];
  for (const [, task] of tasks) {
    if (task.profileId === profileId) {
      profileTasks.push({ ...task });
    }
  }
  const dir = getTasksDir(profileId);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = getTasksPath(profileId) + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify({ tasks: profileTasks }, null, 2));
  fs.renameSync(tmpPath, getTasksPath(profileId));
}

function loadRunHistory(profileId, taskId) {
  try {
    const data = JSON.parse(fs.readFileSync(getRunsPath(profileId, taskId), "utf-8"));
    return data.runs || [];
  } catch {
    return [];
  }
}

function appendRunEntry(profileId, taskId, runEntry) {
  const dir = getRunsDir(profileId, taskId);
  fs.mkdirSync(dir, { recursive: true });
  const runs = loadRunHistory(profileId, taskId);
  runs.push(runEntry);
  // Keep only last 100 runs
  const trimmed = runs.slice(-100);
  const tmpPath = getRunsPath(profileId, taskId) + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify({ runs: trimmed }, null, 2));
  fs.renameSync(tmpPath, getRunsPath(profileId, taskId));
}

function saveRunDetail(profileId, taskId, runId, detail) {
  const dir = getRunsDir(profileId, taskId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getRunDetailPath(profileId, taskId, runId), JSON.stringify(detail, null, 2));
}

// --- Migration from old schedules format ---

function migrateSchedulesToTasks(profileId) {
  const oldPath = path.join(getTasksDir(profileId), "schedules.json");
  const newPath = getTasksPath(profileId);

  if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
    console.log(`[tasks] Migrating schedules.json to tasks.json for profile ${profileId}`);
    try {
      const data = JSON.parse(fs.readFileSync(oldPath, "utf-8"));
      const schedules = data.schedules || [];

      const { workspaceRoot } = getProfilePaths(profileId);
      const migrated = schedules.map((schedule) => {
        const repoName = schedule.repoFullName ? schedule.repoFullName.split("/").pop() : "unknown";
        const workingDirectory = path.join(workspaceRoot, repoName);
        const { provider, repoFullName, ...rest } = schedule;
        return { ...rest, workingDirectory };
      });

      fs.writeFileSync(newPath, JSON.stringify({ tasks: migrated }, null, 2));

      // Rename schedule-runs to task-runs
      const oldRunsDir = path.join(getTasksDir(profileId), "schedule-runs");
      const newRunsDir = path.join(getTasksDir(profileId), "task-runs");
      if (fs.existsSync(oldRunsDir) && !fs.existsSync(newRunsDir)) {
        fs.renameSync(oldRunsDir, newRunsDir);
      }

      console.log(`[tasks] Successfully migrated ${migrated.length} schedule(s) to tasks`);
    } catch (err) {
      console.error(`[tasks] Failed to migrate schedules:`, err.message);
    }
  }
}

// --- Cron helpers ---

export function computeNextRun(cronExpression) {
  if (!cronExpression) return null;
  try {
    const interval = cronParser.parseExpression(cronExpression);
    return interval.next().getTime();
  } catch {
    return null;
  }
}

export function validateCron(cronExpression) {
  try {
    cronParser.parseExpression(cronExpression);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

export function getNextRuns(cronExpression, count = 3) {
  try {
    const interval = cronParser.parseExpression(cronExpression);
    const runs = [];
    for (let i = 0; i < count; i++) {
      runs.push(interval.next().getTime());
    }
    return runs;
  } catch {
    return [];
  }
}

// --- CRUD ---

export function createTask(profileId, config) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const hasCron = !!config.cronExpression;
  const task = {
    id,
    profileId,
    name: config.name,
    enabled: hasCron, // only scheduled tasks start enabled
    cronExpression: config.cronExpression || null,
    workingDirectory: config.workingDirectory,
    prompt: config.prompt,
    createdAt: now,
    updatedAt: now,
    lastRunAt: null,
    lastRunStatus: null,
    nextRunAt: hasCron ? computeNextRun(config.cronExpression) : null,
  };
  tasks.set(id, task);
  persistTasks(profileId);
  return task;
}

export function getTask(taskId) {
  return tasks.get(taskId) || null;
}

export function listTasks(profileId) {
  const result = [];
  for (const [, task] of tasks) {
    if (task.profileId === profileId) {
      result.push({ ...task });
    }
  }
  return result.sort((a, b) => b.createdAt - a.createdAt);
}

export function updateTask(taskId, updates) {
  const task = tasks.get(taskId);
  if (!task) return null;

  if (updates.name !== undefined) task.name = updates.name;
  if (updates.cronExpression !== undefined) {
    task.cronExpression = updates.cronExpression || null;
    if (task.cronExpression) {
      task.nextRunAt = computeNextRun(updates.cronExpression);
    } else {
      task.nextRunAt = null;
      task.enabled = false;
    }
  }
  if (updates.workingDirectory !== undefined) task.workingDirectory = updates.workingDirectory;
  if (updates.prompt !== undefined) task.prompt = updates.prompt;
  task.updatedAt = Date.now();

  tasks.set(taskId, task);
  persistTasks(task.profileId);
  return task;
}

export function deleteTask(taskId) {
  const task = tasks.get(taskId);
  if (!task) return false;
  const profileId = task.profileId;
  tasks.delete(taskId);
  persistTasks(profileId);

  // Clean up run history
  try {
    const runsDir = getRunsDir(profileId, taskId);
    fs.rmSync(runsDir, { recursive: true, force: true });
  } catch {}

  return true;
}

export function toggleTask(taskId, enabled) {
  const task = tasks.get(taskId);
  if (!task) return null;
  // Only allow toggling for scheduled tasks
  if (!task.cronExpression) return task;
  task.enabled = !!enabled;
  if (task.enabled) {
    task.nextRunAt = computeNextRun(task.cronExpression);
  }
  task.updatedAt = Date.now();
  tasks.set(taskId, task);
  persistTasks(task.profileId);
  return task;
}

// --- Run history ---

export function getRunHistory(taskId, limit = 20) {
  const task = tasks.get(taskId);
  if (!task) return [];
  const runs = loadRunHistory(task.profileId, taskId);
  return runs.slice(-limit).reverse(); // Most recent first
}

export function getRunDetail(taskId, runId) {
  const task = tasks.get(taskId);
  if (!task) return null;
  try {
    return JSON.parse(fs.readFileSync(getRunDetailPath(task.profileId, taskId, runId), "utf-8"));
  } catch {
    return null;
  }
}

export function getAllRuns(profileId, limit = 50) {
  const result = [];
  for (const [taskId, task] of tasks) {
    if (task.profileId !== profileId) continue;
    const runs = loadRunHistory(profileId, taskId);
    for (const run of runs) {
      result.push({
        ...run,
        taskId,
        taskName: task.name,
      });
    }
  }
  // Sort by startedAt descending
  result.sort((a, b) => b.startedAt - a.startedAt);
  return result.slice(0, limit);
}

// --- Execution ---

export async function executeTask(taskId) {
  const task = tasks.get(taskId);
  if (!task) return;
  if (runningJobs.has(taskId)) return;

  const runId = crypto.randomUUID();
  const conversation = [];

  runningJobs.add(taskId);
  const startedAt = Date.now();
  let agentId = null;

  console.log(`[tasks] Starting run ${runId} for task "${task.name}" (${taskId})`);

  try {
    // Verify working directory exists
    if (!fs.existsSync(task.workingDirectory)) {
      throw new Error(`Working directory does not exist: ${task.workingDirectory}`);
    }

    // Create ephemeral agent in the workspace directory
    const agent = createAgent(`task-${task.name}-${runId}`, task.workingDirectory, task.profileId);
    agentId = agent.id;

    // Disable interactive questions for task runs
    agent.interactiveQuestions = false;

    // Capture events
    const listener = (event) => {
      conversation.push(event);
    };
    subscribeAgent(agent.id, listener);

    // Run prompt
    await sendMessage(agent.id, task.prompt);

    // Extract results
    unsubscribeAgent(agent.id, listener);
    const doneEvent = conversation.find((e) => e.type === "done");
    const assistantTexts = conversation
      .filter((e) => e.type === "text_delta")
      .map((e) => e.text)
      .join("");

    // Persist
    const runEntry = {
      id: runId,
      taskId,
      status: "success",
      startedAt,
      completedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      cost: doneEvent?.cost || 0,
      usage: doneEvent?.usage || null,
      error: null,
      resultSummary: assistantTexts.slice(0, 500),
    };

    saveRunDetail(task.profileId, taskId, runId, {
      ...runEntry,
      conversation: conversation.map((e) => {
        const { eventIndex, ...rest } = e;
        return rest;
      }),
    });
    appendRunEntry(task.profileId, taskId, runEntry);

    // Update task
    task.lastRunAt = Date.now();
    task.lastRunStatus = "success";
    if (task.cronExpression) {
      task.nextRunAt = computeNextRun(task.cronExpression);
    }
    persistTasks(task.profileId);

    // Cleanup agent
    deleteAgent(agent.id);
    agentId = null;

    console.log(`[tasks] Run ${runId} completed successfully for "${task.name}"`);

    // Notify listeners
    for (const listener of runCompleteListeners) {
      try {
        listener({ taskId, runId, task: { ...task }, runEntry });
      } catch {}
    }
  } catch (err) {
    console.error(`[tasks] Run ${runId} failed for "${task.name}":`, err.message);

    // Record failed run
    const runEntry = {
      id: runId,
      taskId,
      status: "error",
      startedAt,
      completedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      cost: 0,
      usage: null,
      error: err.message,
      resultSummary: null,
    };
    appendRunEntry(task.profileId, taskId, runEntry);

    task.lastRunAt = Date.now();
    task.lastRunStatus = "error";
    if (task.cronExpression) {
      task.nextRunAt = computeNextRun(task.cronExpression);
    }
    persistTasks(task.profileId);

    // Cleanup agent if created
    if (agentId) {
      try {
        deleteAgent(agentId);
      } catch {}
    }

    // Notify listeners
    for (const listener of runCompleteListeners) {
      try {
        listener({ taskId, runId, task: { ...task }, runEntry });
      } catch {}
    }
  } finally {
    runningJobs.delete(taskId);
  }
}

export function triggerTask(taskId) {
  const task = tasks.get(taskId);
  if (!task) return false;
  if (runningJobs.has(taskId)) return false;
  // Fire async, don't await
  executeTask(taskId);
  return true;
}

export function isRunning(taskId) {
  return runningJobs.has(taskId);
}

// --- Task scheduler lifecycle ---

function tick() {
  const now = Date.now();
  for (const [id, task] of tasks) {
    if (!task.enabled) continue;
    if (!task.cronExpression) continue;
    if (runningJobs.has(id)) continue;
    if (task.nextRunAt && task.nextRunAt <= now) {
      executeTask(id);
    }
  }
}

export function startTaskScheduler() {
  // Migrate old schedules format for all profiles
  const profiles = listProfiles();
  for (const profile of profiles) {
    migrateSchedulesToTasks(profile.id);
  }

  // Load all tasks from all profiles
  for (const profile of profiles) {
    const diskTasks = loadTasksFromDisk(profile.id);
    for (const task of diskTasks) {
      // Ensure profileId is set (legacy data may not have it)
      task.profileId = profile.id;
      // Recalculate nextRunAt in case server was down
      if (task.enabled && task.cronExpression) {
        task.nextRunAt = computeNextRun(task.cronExpression);
      }
      tasks.set(task.id, task);
    }
  }

  console.log(`[tasks] Loaded ${tasks.size} task(s) from disk`);

  // Start tick loop every 30 seconds
  tickInterval = setInterval(tick, 30000);
  // Also run immediately
  tick();
}

export function stopTaskScheduler() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

// --- Event listeners ---

export function onRunComplete(listener) {
  runCompleteListeners.add(listener);
}

export function offRunComplete(listener) {
  runCompleteListeners.delete(listener);
}
