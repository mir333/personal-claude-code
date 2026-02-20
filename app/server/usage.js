import { readFileSync, writeFileSync, mkdirSync, renameSync } from "fs";
import { randomBytes } from "crypto";
import path from "path";
import { homedir } from "os";

const USAGE_DIR = path.join(homedir(), ".claude-ui");
const USAGE_FILE = path.join(USAGE_DIR, "usage.json");

// In-memory session stats (resets on server restart), keyed by profileId (or "_global")
const sessions = {};

function getSession(profileId) {
  const key = profileId || "_global";
  if (!sessions[key]) {
    sessions[key] = {
      totalCost: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      requests: 0,
      modelCosts: {},
    };
  }
  return sessions[key];
}

function getUsageFilePath(profileId) {
  if (profileId) {
    return path.join("/home/node/.claude/profiles", profileId, "usage.json");
  }
  return USAGE_FILE;
}

function loadWeeklyFile(profileId) {
  try {
    return JSON.parse(readFileSync(getUsageFilePath(profileId), "utf-8"));
  } catch {
    return { daily: {} };
  }
}

function saveWeeklyFile(data, profileId) {
  const filePath = getUsageFilePath(profileId);
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmp = filePath + "." + randomBytes(4).toString("hex") + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, filePath);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getWeekBounds() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const diffToMon = day === 0 ? 6 : day - 1;
  const mon = new Date(now);
  mon.setDate(mon.getDate() - diffToMon);
  mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setDate(sun.getDate() + 6);
  sun.setHours(23, 59, 59, 999);
  return { mon, sun };
}

export function recordUsage(doneMsg, profileId) {
  const usage = doneMsg.usage || {};
  const cost = doneMsg.cost || 0;
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheCreation = usage.cache_creation_input_tokens || 0;

  const modelUsage = doneMsg.modelUsage || {};

  // Update in-memory session
  const session = getSession(profileId);
  session.totalCost += cost;
  session.inputTokens += input;
  session.outputTokens += output;
  session.cacheReadTokens += cacheRead;
  session.cacheCreationTokens += cacheCreation;
  session.requests += 1;
  for (const [model, mu] of Object.entries(modelUsage)) {
    const s = session.modelCosts[model] || { cost: 0, inputTokens: 0, outputTokens: 0 };
    s.cost += mu.costUSD || 0;
    s.inputTokens += mu.inputTokens || 0;
    s.outputTokens += mu.outputTokens || 0;
    session.modelCosts[model] = s;
  }

  // Persist daily entry
  const data = loadWeeklyFile(profileId);
  const key = todayKey();
  const day = data.daily[key] || {
    cost: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    requests: 0,
    modelCosts: {},
  };
  day.cost += cost;
  day.inputTokens += input;
  day.outputTokens += output;
  day.cacheReadTokens += cacheRead;
  day.cacheCreationTokens += cacheCreation;
  day.requests += 1;
  for (const [model, mu] of Object.entries(modelUsage)) {
    const d = day.modelCosts[model] || { cost: 0, inputTokens: 0, outputTokens: 0 };
    d.cost += mu.costUSD || 0;
    d.inputTokens += mu.inputTokens || 0;
    d.outputTokens += mu.outputTokens || 0;
    day.modelCosts[model] = d;
  }
  data.daily[key] = day;
  saveWeeklyFile(data, profileId);
}

export function getUsageStats(profileId) {
  // Compute weekly aggregate from persisted daily data
  const data = loadWeeklyFile(profileId);
  const { mon, sun } = getWeekBounds();
  const weekly = {
    totalCost: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    requests: 0,
    modelCosts: {},
  };

  for (const [dateStr, day] of Object.entries(data.daily)) {
    const d = new Date(dateStr + "T00:00:00");
    if (d >= mon && d <= sun) {
      weekly.totalCost += day.cost;
      weekly.inputTokens += day.inputTokens;
      weekly.outputTokens += day.outputTokens;
      weekly.cacheReadTokens += day.cacheReadTokens || 0;
      weekly.cacheCreationTokens += day.cacheCreationTokens || 0;
      weekly.requests += day.requests;
      for (const [model, mu] of Object.entries(day.modelCosts || {})) {
        const w = weekly.modelCosts[model] || { cost: 0, inputTokens: 0, outputTokens: 0 };
        w.cost += mu.cost || 0;
        w.inputTokens += mu.inputTokens || 0;
        w.outputTokens += mu.outputTokens || 0;
        weekly.modelCosts[model] = w;
      }
    }
  }

  const session = getSession(profileId);
  return {
    session: { ...session, modelCosts: { ...session.modelCosts } },
    weekly,
  };
}
