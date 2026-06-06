import fs from "fs";
import path from "path";
import os from "os";

// Anthropic's authoritative OAuth usage endpoint. Returns server-computed
// utilization percentages for the rolling 5-hour and 7-day plan windows — the
// same numbers Claude Code itself uses. This is accurate by construction, unlike
// estimating from local JSONL token counts.
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CACHE_TTL_MS = 30_000;
const FETCH_TIMEOUT_MS = 5_000;

function credentialsPath() {
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  return path.join(dir, ".credentials.json");
}

/** Read the Claude Code OAuth access token from the credentials file (or null). */
export function readOAuthToken() {
  try {
    const json = JSON.parse(fs.readFileSync(credentialsPath(), "utf-8"));
    return json.claudeAiOauth?.accessToken || null;
  } catch {
    return null;
  }
}

/**
 * Pure: map the usage endpoint JSON into our shape.
 * Returns { fiveHour, sevenDay } where each is { utilization, resetAt } or null.
 * `utilization` is a 0-100 percentage; `resetAt` is epoch ms (or null).
 */
export function parseUsage(data) {
  const pick = (o) => {
    if (!o || typeof o.utilization !== "number") return null;
    const resetAt = o.resets_at ? Date.parse(o.resets_at) : null;
    return { utilization: o.utilization, resetAt: Number.isNaN(resetAt) ? null : resetAt };
  };
  return { fiveHour: pick(data?.five_hour), sevenDay: pick(data?.seven_day) };
}

let _cache = { at: 0, value: null };

const UNAVAILABLE = { available: false, fiveHour: null, sevenDay: null };

/**
 * Fetch the live plan-window utilization from Anthropic's OAuth usage endpoint.
 * Cached for 30s. Returns { available, fiveHour, sevenDay }. On any error (no
 * token, network failure, non-200) returns { available: false }.
 */
export async function readWindow(now = Date.now()) {
  if (_cache.value && now - _cache.at < CACHE_TTL_MS) return _cache.value;

  const token = readOAuthToken();
  if (!token) {
    _cache = { at: now, value: UNAVAILABLE };
    return UNAVAILABLE;
  }

  let value = UNAVAILABLE;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      value = { available: true, ...parseUsage(data) };
    }
  } catch {
    value = UNAVAILABLE;
  }

  _cache = { at: now, value };
  return value;
}
