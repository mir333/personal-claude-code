import fs from "fs";
import path from "path";
import crypto from "crypto";
import cronParser from "cron-parser";
import { getProfilePaths, listProfiles } from "./profiles.js";
import {
  buildCloneUrl,
  getProviderToken,
  getProviderConfig,
  execPromise,
  gitEnvForProfile,
  configureLocalGit,
} from "./providers.js";
import {
  createAgent,
  sendMessage,
  deleteAgent,
  subscribeAgent,
  unsubscribeAgent,
} from "./agents.js";

// --- In-memory state ---
const schedules = new Map(); // scheduleId -> Schedule
const runningJobs = new Set(); // scheduleIds currently executing
let tickInterval = null;
const runCompleteListeners = new Set(); // Set of callback functions

// --- Storage paths ---

function getSchedulesDir(profileId) {
  return path.join("/home/node/.claude/profiles", profileId);
}

function getSchedulesPath(profileId) {
  return path.join(getSchedulesDir(profileId), "schedules.json");
}

function getRunsDir(profileId, scheduleId) {
  return path.join(getSchedulesDir(profileId), "schedule-runs", scheduleId);
}

function getRunsPath(profileId, scheduleId) {
  return path.join(getRunsDir(profileId, scheduleId), "runs.json");
}

function getRunDetailPath(profileId, scheduleId, runId) {
  return path.join(getRunsDir(profileId, scheduleId), `${runId}.json`);
}

// --- Storage helpers ---

function loadSchedulesFromDisk(profileId) {
  try {
    const data = JSON.parse(fs.readFileSync(getSchedulesPath(profileId), "utf-8"));
    return data.schedules || [];
  } catch {
    return [];
  }
}

function persistSchedules(profileId) {
  const profileSchedules = [];
  for (const [, schedule] of schedules) {
    if (schedule.profileId === profileId) {
      profileSchedules.push({ ...schedule });
    }
  }
  const dir = getSchedulesDir(profileId);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = getSchedulesPath(profileId) + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify({ schedules: profileSchedules }, null, 2));
  fs.renameSync(tmpPath, getSchedulesPath(profileId));
}

function loadRunHistory(profileId, scheduleId) {
  try {
    const data = JSON.parse(fs.readFileSync(getRunsPath(profileId, scheduleId), "utf-8"));
    return data.runs || [];
  } catch {
    return [];
  }
}

function appendRunEntry(profileId, scheduleId, runEntry) {
  const dir = getRunsDir(profileId, scheduleId);
  fs.mkdirSync(dir, { recursive: true });
  const runs = loadRunHistory(profileId, scheduleId);
  runs.push(runEntry);
  // Keep only last 100 runs
  const trimmed = runs.slice(-100);
  const tmpPath = getRunsPath(profileId, scheduleId) + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify({ runs: trimmed }, null, 2));
  fs.renameSync(tmpPath, getRunsPath(profileId, scheduleId));
}

function saveRunDetail(profileId, scheduleId, runId, detail) {
  const dir = getRunsDir(profileId, scheduleId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getRunDetailPath(profileId, scheduleId, runId), JSON.stringify(detail, null, 2));
}

// --- Cron helpers ---

export function computeNextRun(cronExpression) {
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

export function createSchedule(profileId, config) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const schedule = {
    id,
    profileId,
    name: config.name,
    enabled: true,
    cronExpression: config.cronExpression,
    provider: config.provider,
    repoFullName: config.repoFullName,
    prompt: config.prompt,
    createdAt: now,
    updatedAt: now,
    lastRunAt: null,
    lastRunStatus: null,
    nextRunAt: computeNextRun(config.cronExpression),
  };
  schedules.set(id, schedule);
  persistSchedules(profileId);
  return schedule;
}

export function getSchedule(scheduleId) {
  return schedules.get(scheduleId) || null;
}

export function listSchedules(profileId) {
  const result = [];
  for (const [, schedule] of schedules) {
    if (schedule.profileId === profileId) {
      result.push({ ...schedule });
    }
  }
  return result.sort((a, b) => b.createdAt - a.createdAt);
}

export function updateSchedule(scheduleId, updates) {
  const schedule = schedules.get(scheduleId);
  if (!schedule) return null;

  if (updates.name !== undefined) schedule.name = updates.name;
  if (updates.cronExpression !== undefined) {
    schedule.cronExpression = updates.cronExpression;
    schedule.nextRunAt = computeNextRun(updates.cronExpression);
  }
  if (updates.provider !== undefined) schedule.provider = updates.provider;
  if (updates.repoFullName !== undefined) schedule.repoFullName = updates.repoFullName;
  if (updates.prompt !== undefined) schedule.prompt = updates.prompt;
  schedule.updatedAt = Date.now();

  schedules.set(scheduleId, schedule);
  persistSchedules(schedule.profileId);
  return schedule;
}

export function deleteSchedule(scheduleId) {
  const schedule = schedules.get(scheduleId);
  if (!schedule) return false;
  const profileId = schedule.profileId;
  schedules.delete(scheduleId);
  persistSchedules(profileId);

  // Clean up run history
  try {
    const runsDir = getRunsDir(profileId, scheduleId);
    fs.rmSync(runsDir, { recursive: true, force: true });
  } catch {}

  return true;
}

export function toggleSchedule(scheduleId, enabled) {
  const schedule = schedules.get(scheduleId);
  if (!schedule) return null;
  schedule.enabled = !!enabled;
  if (schedule.enabled) {
    schedule.nextRunAt = computeNextRun(schedule.cronExpression);
  }
  schedule.updatedAt = Date.now();
  schedules.set(scheduleId, schedule);
  persistSchedules(schedule.profileId);
  return schedule;
}

// --- Run history ---

export function getRunHistory(scheduleId, limit = 20) {
  const schedule = schedules.get(scheduleId);
  if (!schedule) return [];
  const runs = loadRunHistory(schedule.profileId, scheduleId);
  return runs.slice(-limit).reverse(); // Most recent first
}

export function getRunDetail(scheduleId, runId) {
  const schedule = schedules.get(scheduleId);
  if (!schedule) return null;
  try {
    return JSON.parse(fs.readFileSync(getRunDetailPath(schedule.profileId, scheduleId, runId), "utf-8"));
  } catch {
    return null;
  }
}

// --- Execution ---

export async function executeSchedule(scheduleId) {
  const schedule = schedules.get(scheduleId);
  if (!schedule) return;
  if (runningJobs.has(scheduleId)) return;

  const runId = crypto.randomUUID();
  const runDir = `/tmp/schedule-runs/${scheduleId}/${runId}`;
  const conversation = [];

  runningJobs.add(scheduleId);
  const startedAt = Date.now();
  let agentId = null;

  console.log(`[scheduler] Starting run ${runId} for schedule "${schedule.name}" (${scheduleId})`);

  try {
    // 1. Clone repo
    fs.mkdirSync(runDir, { recursive: true });
    const cloneUrl = buildCloneUrl(schedule.provider, schedule.repoFullName, schedule.profileId);
    await execPromise("git", ["clone", cloneUrl, "repo"], {
      cwd: runDir,
      timeout: 120000,
      env: { ...process.env, ...gitEnvForProfile(schedule.profileId) },
    });
    const repoDir = path.join(runDir, "repo");
    await configureLocalGit(repoDir, schedule.profileId);

    // 2. Create ephemeral agent
    const agent = createAgent(`schedule-${schedule.name}-${runId}`, repoDir, schedule.profileId);
    agentId = agent.id;

    // Disable interactive questions for scheduled runs
    agent.interactiveQuestions = false;

    // 3. Capture events
    const listener = (event) => {
      conversation.push(event);
    };
    subscribeAgent(agent.id, listener);

    // 4. Run prompt
    await sendMessage(agent.id, schedule.prompt);

    // 5. Extract results
    unsubscribeAgent(agent.id, listener);
    const doneEvent = conversation.find((e) => e.type === "done");
    const assistantTexts = conversation
      .filter((e) => e.type === "text_delta")
      .map((e) => e.text)
      .join("");

    // 6. Persist
    const runEntry = {
      id: runId,
      scheduleId,
      status: "success",
      startedAt,
      completedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      cost: doneEvent?.cost || 0,
      usage: doneEvent?.usage || null,
      error: null,
      resultSummary: assistantTexts.slice(0, 500),
    };

    saveRunDetail(schedule.profileId, scheduleId, runId, {
      ...runEntry,
      conversation: conversation.map((e) => {
        // Strip eventIndex for storage
        const { eventIndex, ...rest } = e;
        return rest;
      }),
    });
    appendRunEntry(schedule.profileId, scheduleId, runEntry);

    // 7. Update schedule
    schedule.lastRunAt = Date.now();
    schedule.lastRunStatus = "success";
    schedule.nextRunAt = computeNextRun(schedule.cronExpression);
    persistSchedules(schedule.profileId);

    // 8. Cleanup agent
    deleteAgent(agent.id);
    agentId = null;

    console.log(`[scheduler] Run ${runId} completed successfully for "${schedule.name}"`);

    // Notify listeners
    for (const listener of runCompleteListeners) {
      try {
        listener({ scheduleId, runId, schedule: { ...schedule }, runEntry });
      } catch {}
    }
  } catch (err) {
    console.error(`[scheduler] Run ${runId} failed for "${schedule.name}":`, err.message);

    // Record failed run
    const runEntry = {
      id: runId,
      scheduleId,
      status: "error",
      startedAt,
      completedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      cost: 0,
      usage: null,
      error: err.message,
      resultSummary: null,
    };
    appendRunEntry(schedule.profileId, scheduleId, runEntry);

    schedule.lastRunAt = Date.now();
    schedule.lastRunStatus = "error";
    schedule.nextRunAt = computeNextRun(schedule.cronExpression);
    persistSchedules(schedule.profileId);

    // Cleanup agent if created
    if (agentId) {
      try {
        deleteAgent(agentId);
      } catch {}
    }

    // Notify listeners
    for (const listener of runCompleteListeners) {
      try {
        listener({ scheduleId, runId, schedule: { ...schedule }, runEntry });
      } catch {}
    }
  } finally {
    runningJobs.delete(scheduleId);
    // Clean up temp directory
    try {
      fs.rmSync(runDir, { recursive: true, force: true });
    } catch {}
  }
}

export function triggerSchedule(scheduleId) {
  const schedule = schedules.get(scheduleId);
  if (!schedule) return false;
  if (runningJobs.has(scheduleId)) return false;
  // Fire async, don't await
  executeSchedule(scheduleId);
  return true;
}

export function isRunning(scheduleId) {
  return runningJobs.has(scheduleId);
}

// --- Scheduler lifecycle ---

function tick() {
  const now = Date.now();
  for (const [id, schedule] of schedules) {
    if (!schedule.enabled) continue;
    if (runningJobs.has(id)) continue;
    if (schedule.nextRunAt && schedule.nextRunAt <= now) {
      executeSchedule(id);
    }
  }
}

export function startScheduler() {
  // Load all schedules from all profiles
  const profiles = listProfiles();
  for (const profile of profiles) {
    const diskSchedules = loadSchedulesFromDisk(profile.id);
    for (const schedule of diskSchedules) {
      // Ensure profileId is set (legacy data may not have it)
      schedule.profileId = profile.id;
      // Recalculate nextRunAt in case server was down
      if (schedule.enabled) {
        schedule.nextRunAt = computeNextRun(schedule.cronExpression);
      }
      schedules.set(schedule.id, schedule);
    }
  }

  console.log(`[scheduler] Loaded ${schedules.size} schedule(s) from disk`);

  // Clean up orphaned temp directories
  try {
    fs.rmSync("/tmp/schedule-runs", { recursive: true, force: true });
  } catch {}

  // Start tick loop every 30 seconds
  tickInterval = setInterval(tick, 30000);
  // Also run immediately
  tick();
}

export function stopScheduler() {
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
