import { readFileSync, writeFileSync, mkdirSync, renameSync } from "fs";
import { randomBytes } from "crypto";
import path from "path";
import { homedir } from "os";

const USAGE_DIR = path.join(homedir(), ".claude-ui");
const USAGE_FILE = path.join(USAGE_DIR, "usage.json");

// In-memory session stats (resets on server restart)
const session = {
  totalCost: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  requests: 0,
  modelCosts: {},  // { [modelName]: { cost, inputTokens, outputTokens } }
};

function loadWeeklyFile() {
  try {
    return JSON.parse(readFileSync(USAGE_FILE, "utf-8"));
  } catch {
    return { daily: {} };
  }
}

function saveWeeklyFile(data) {
  mkdirSync(USAGE_DIR, { recursive: true });
  const tmp = USAGE_FILE + "." + randomBytes(4).toString("hex") + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, USAGE_FILE);
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

export function recordUsage(doneMsg) {
  const usage = doneMsg.usage || {};
  const cost = doneMsg.cost || 0;
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheCreation = usage.cache_creation_input_tokens || 0;

  const modelUsage = doneMsg.modelUsage || {};

  // Update in-memory session
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
  const data = loadWeeklyFile();
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
  saveWeeklyFile(data);
}

export function getUsageStats() {
  // Compute weekly aggregate from persisted daily data
  const data = loadWeeklyFile();
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

  return {
    session: { ...session, modelCosts: { ...session.modelCosts } },
    weekly,
  };
}
