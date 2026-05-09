import fs from "fs";
import path from "path";
import crypto from "crypto";
import { CronExpressionParser } from "cron-parser";
import { getProfilePaths, listProfiles } from "./profiles.js";
import {
  createAgent,
  sendMessage,
  deleteAgent,
  abortAgent,
  subscribeAgent,
  unsubscribeAgent,
} from "./agents.js";
const SUMMARY_INSTRUCTION = `\n\n---\n**IMPORTANT:** After completing your task, you MUST create a markdown file called \`summary.md\` in the current working directory with a complete summary of your findings, analysis, and results. All output files must be saved to the current working directory (the connected workspace).`;

// --- .claude-tasks helpers ---

function getClaudeTasksDir(workspaceDir) {
  return path.join(workspaceDir, ".claude-tasks");
}

function generateSummaryFilename(taskName, runId) {
  const slug = taskName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${slug}-${timestamp}-${runId.slice(0, 8)}.md`;
}

/**
 * Persist the task result to .claude-tasks/ in the connected workspace.
 * This is NOT done by the LLM — it's a programmatic function that picks up
 * the last assistant message from the conversation and saves it as a file.
 */
function persistSummaryToWorkspace(workspaceDir, filename, conversation, assistantText) {
  const claudeTasksDir = getClaudeTasksDir(workspaceDir);
  fs.mkdirSync(claudeTasksDir, { recursive: true });

  const destPath = path.join(claudeTasksDir, filename);

  // Strategy 1: If the agent wrote a summary.md to the workspace, use that
  try {
    const agentSummaryPath = path.join(workspaceDir, "summary.md");
    if (fs.existsSync(agentSummaryPath)) {
      fs.copyFileSync(agentSummaryPath, destPath);
      fs.unlinkSync(agentSummaryPath); // Clean up from workspace root
      return destPath;
    }
  } catch (err) {
    console.error(`[tasks] Failed to copy agent summary.md:`, err.message);
  }

  // Strategy 2: Pick up the last assistant message from the conversation and save it
  if (assistantText && assistantText.trim()) {
    try {
      fs.writeFileSync(destPath, assistantText);
      return destPath;
    } catch (err) {
      console.error(`[tasks] Failed to write summary to .claude-tasks/:`, err.message);
    }
  }

  return null;
}
// --- In-memory state ---
const tasks = new Map(); // taskId -> Task
const runningJobs = new Map(); // taskId -> { agentId, aborted }
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

function getRunOutputDir(profileId, taskId, runId) {
  return path.join(getRunsDir(profileId, taskId), "output", runId);
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
    const interval = CronExpressionParser.parse(cronExpression);
    return interval.next().getTime();
  } catch {
    return null;
  }
}

export function validateCron(cronExpression) {
  try {
    CronExpressionParser.parse(cronExpression);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

export function getNextRuns(cronExpression, count = 3) {
  try {
    const interval = CronExpressionParser.parse(cronExpression);
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
  const emails = Array.isArray(config.emails) ? config.emails.filter(e => e && e.trim()) : [];
  const task = {
    id,
    profileId,
    name: config.name,
    enabled: hasCron, // only scheduled tasks start enabled
    cronExpression: config.cronExpression || null,
    workingDirectory: config.workingDirectory,
    prompt: config.prompt,
    model: config.model || null,
    emails,
    webhookToken: null,
    webhookBaseUrl: null,
    createdAt: now,
    updatedAt: now,
    lastRunAt: null,
    lastRunStatus: null,
    nextRunAt: hasCron ? computeNextRun(config.cronExpression) : null,
  };
  // Auto-generate webhook token if emails are configured (needed for public summary URL)
  if (task.emails.length > 0) {
    task.webhookToken = crypto.randomBytes(32).toString("hex");
    if (config.webhookBaseUrl) task.webhookBaseUrl = config.webhookBaseUrl;
  }
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
  if (updates.model !== undefined) task.model = updates.model || null;
  if (updates.emails !== undefined) {
    task.emails = Array.isArray(updates.emails) ? updates.emails.filter(e => e && e.trim()) : [];
    // Auto-generate webhook token if emails are set and no token exists
    if (task.emails.length > 0 && !task.webhookToken) {
      task.webhookToken = crypto.randomBytes(32).toString("hex");
      if (updates.webhookBaseUrl) task.webhookBaseUrl = updates.webhookBaseUrl;
    }
  }
  if (updates.webhookBaseUrl && task.webhookToken) {
    task.webhookBaseUrl = updates.webhookBaseUrl;
  }
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

export function generateWebhookToken(taskId, baseUrl) {
  const task = tasks.get(taskId);
  if (!task) return null;
  task.webhookToken = crypto.randomBytes(32).toString("hex");
  if (baseUrl) task.webhookBaseUrl = baseUrl;
  task.updatedAt = Date.now();
  tasks.set(taskId, task);
  persistTasks(task.profileId);
  return task.webhookToken;
}

export function revokeWebhookToken(taskId) {
  const task = tasks.get(taskId);
  if (!task) return false;
  task.webhookToken = null;
  task.webhookBaseUrl = null;
  task.updatedAt = Date.now();
  tasks.set(taskId, task);
  persistTasks(task.profileId);
  return true;
}

export function getTaskByWebhookToken(taskId, token) {
  const task = tasks.get(taskId);
  if (!task || !task.webhookToken) return null;
  const expected = Buffer.from(task.webhookToken, "utf-8");
  const received = Buffer.from(token, "utf-8");
  if (expected.length !== received.length) return null;
  if (!crypto.timingSafeEqual(expected, received)) return null;
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

// Archive output files into the run output directory.
// The primary summary is already persisted to .claude-tasks/ by persistSummaryToWorkspace.
// This function creates a copy in the archive dir and records file metadata.
function archiveOutputFiles(outputDir, claudeTasksSummaryPath) {
  const archived = [];
  fs.mkdirSync(outputDir, { recursive: true });

  if (claudeTasksSummaryPath && fs.existsSync(claudeTasksSummaryPath)) {
    try {
      const destPath = path.join(outputDir, "summary.md");
      fs.copyFileSync(claudeTasksSummaryPath, destPath);
      const stat = fs.statSync(destPath);
      archived.push({ name: "summary.md", size: stat.size });
    } catch (err) {
      console.error(`[tasks] Failed to archive summary to output dir:`, err.message);
    }
  }

  return archived;
}

function scanOutputFiles(dir) {
  try {
    if (!fs.existsSync(dir)) return [];
    const files = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && !entry.name.startsWith(".")) {
        const stat = fs.statSync(path.join(dir, entry.name));
        files.push({ name: entry.name, size: stat.size });
      }
    }
    return files;
  } catch {
    return [];
  }
}

export async function executeTask(taskId, { payload, runId } = {}) {
  const task = tasks.get(taskId);
  if (!task) return;
  if (runningJobs.has(taskId)) return;

  if (!runId) runId = crypto.randomUUID();
  const conversation = [];

  // Generate the target summary filename at the beginning of execution
  const summaryFilename = generateSummaryFilename(task.name, runId);

  runningJobs.set(taskId, { agentId: null, aborted: false });
  const startedAt = Date.now();
  let agentId = null;

  // Output directory for archiving task-generated files
  const outputDir = getRunOutputDir(task.profileId, taskId, runId);

  console.log(`[tasks] Starting run ${runId} for task "${task.name}" (${taskId}), summary file: ${summaryFilename}`);

  try {
    // Verify working directory exists
    if (!fs.existsSync(task.workingDirectory)) {
      throw new Error(`Working directory does not exist: ${task.workingDirectory}`);
    }

    // Create ephemeral agent in the workspace directory
    const agent = createAgent(`task-${task.name}-${runId}`, task.workingDirectory, task.profileId);
    agentId = agent.id;

    // Store agentId in runningJobs so stopTask() can abort it
    const job = runningJobs.get(taskId);
    if (job) job.agentId = agent.id;

    // Disable interactive questions for task runs
    agent.interactiveQuestions = false;

    // Apply model override from task config
    if (task.model) {
      agent.model = task.model;
    }

    // Capture events
    const listener = (event) => {
      conversation.push(event);
    };
    subscribeAgent(agent.id, listener);

    // Build prompt — always instruct agent to save a summary file in the workspace
    let prompt = payload ? `${task.prompt}\n\n${payload}${SUMMARY_INSTRUCTION}` : `${task.prompt}${SUMMARY_INSTRUCTION}`;
    await sendMessage(agent.id, prompt);

    // Check if this task was user-aborted (sendMessage swallows AbortError)
    const jobState = runningJobs.get(taskId);
    const wasAborted = jobState?.aborted === true;

    // Extract results
    unsubscribeAgent(agent.id, listener);
    const doneEvent = conversation.find((e) => e.type === "done");
    const assistantTexts = conversation
      .filter((e) => e.type === "text_delta")
      .map((e) => e.text)
      .join("");

    // Persist summary to .claude-tasks/ in the connected workspace (programmatic, not LLM)
    const claudeTasksSummaryPath = persistSummaryToWorkspace(
      task.workingDirectory, summaryFilename, conversation, assistantTexts
    );

    // Also archive to the run output directory
    const outputFiles = archiveOutputFiles(outputDir, claudeTasksSummaryPath);

    // Persist
    const runEntry = {
      id: runId,
      taskId,
      status: wasAborted ? "interrupted" : "success",
      startedAt,
      completedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      cost: doneEvent?.cost || 0,
      usage: doneEvent?.usage || null,
      error: wasAborted ? "Task stopped by user" : null,
      resultSummary: assistantTexts.slice(0, 500) || null,
      outputFiles: outputFiles.length > 0 ? outputFiles : null,
      summaryFilename, // Store the filename for summary link resolution
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
    task.lastRunStatus = wasAborted ? "interrupted" : "success";
    if (task.cronExpression) {
      task.nextRunAt = computeNextRun(task.cronExpression);
    }
    persistTasks(task.profileId);

    // Cleanup agent
    deleteAgent(agent.id);
    agentId = null;

    console.log(`[tasks] Run ${runId} ${wasAborted ? "interrupted by user" : "completed successfully"} for "${task.name}"`);

    // Notify listeners
    for (const cb of runCompleteListeners) {
      try {
        cb({ taskId, runId, task: { ...task }, runEntry });
      } catch {}
    }
  } catch (err) {
    const jobState = runningJobs.get(taskId);
    const wasAborted = jobState?.aborted === true;

    console.error(`[tasks] Run ${runId} ${wasAborted ? "interrupted" : "failed"} for "${task.name}":`, err.message);

    // Record failed/interrupted run
    const runEntry = {
      id: runId,
      taskId,
      status: wasAborted ? "interrupted" : "error",
      startedAt,
      completedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      cost: 0,
      usage: null,
      error: wasAborted ? "Task stopped by user" : err.message,
      resultSummary: null,
      outputFiles: null,
      summaryFilename,
    };
    appendRunEntry(task.profileId, taskId, runEntry);

    task.lastRunAt = Date.now();
    task.lastRunStatus = wasAborted ? "interrupted" : "error";
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
    for (const cb of runCompleteListeners) {
      try {
        cb({ taskId, runId, task: { ...task }, runEntry });
      } catch {}
    }
  } finally {
    runningJobs.delete(taskId);
  }
}

export function triggerTask(taskId, opts) {
  const task = tasks.get(taskId);
  if (!task) return null;
  if (runningJobs.has(taskId)) return null;
  // Generate runId upfront so callers can build artifact URLs
  const runId = crypto.randomUUID();
  // Generate summary filename upfront so callers can build summary URLs
  const summaryFilename = generateSummaryFilename(task.name, runId);
  // Fire async, don't await
  executeTask(taskId, { ...opts, runId });
  return { runId, summaryFilename };
}

export function isRunning(taskId) {
  return runningJobs.has(taskId);
}

export function stopTask(taskId) {
  const job = runningJobs.get(taskId);
  if (!job) return { stopped: false, reason: "not_running" };
  if (!job.agentId) return { stopped: false, reason: "agent_not_ready" };

  // Mark as user-aborted BEFORE aborting the agent.
  // executeTask checks this flag after sendMessage returns.
  job.aborted = true;

  // Abort the agent's AbortController, causing sendMessage to exit
  abortAgent(job.agentId);

  return { stopped: true };
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
      // Normalize emails field for backward compatibility
      task.emails = task.emails || [];
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

// --- Run artifacts ---

export function getRunArtifacts(taskId, runId) {
  const task = tasks.get(taskId);
  if (!task) return null;
  const outputDir = getRunOutputDir(task.profileId, taskId, runId);
  return scanOutputFiles(outputDir);
}

export function getRunArtifactPath(taskId, runId, filename) {
  const task = tasks.get(taskId);
  if (!task) return null;
  // Sanitize filename to prevent path traversal
  const safe = path.basename(filename);
  const filePath = path.join(getRunOutputDir(task.profileId, taskId, runId), safe);
  if (!fs.existsSync(filePath)) return null;
  return filePath;
}

/**
 * Get the summary file path from the .claude-tasks/ folder in the workspace.
 * This is the primary location where summaries are persisted.
 */
export function getWorkspaceSummaryPath(taskId, summaryFilename) {
  const task = tasks.get(taskId);
  if (!task) return null;
  if (!summaryFilename) return null;
  const safe = path.basename(summaryFilename);
  const filePath = path.join(getClaudeTasksDir(task.workingDirectory), safe);
  if (!fs.existsSync(filePath)) return null;
  return filePath;
}
