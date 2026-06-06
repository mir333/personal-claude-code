import fs from "fs";
import path from "path";
import os from "os";

export const WINDOW_MS = 5 * 60 * 60 * 1000; // 5 hours
const HOUR_MS = 60 * 60 * 1000;
const SCAN_MAX_AGE_MS = 6 * 60 * 60 * 1000; // only parse files touched in last 6h
const CACHE_TTL_MS = 30_000;

/** Counted token measure: input + output + cache_creation (excludes cache_read). */
export function countTokens(usage) {
  if (!usage) return 0;
  return (
    (usage.input_tokens || 0) +
    (usage.output_tokens || 0) +
    (usage.cache_creation_input_tokens || 0)
  );
}

/**
 * Pure: given parsed entries [{ ts (ms), id, usage }] and `now` (ms), group into
 * 5-hour blocks and return the active window.
 * Returns { active, usedTokens, windowStart, resetAt }.
 */
export function computeWindow(entries, now) {
  // Dedup by message id (keep first occurrence).
  const seen = new Set();
  const deduped = [];
  for (const e of entries) {
    if (e.id != null) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
    }
    deduped.push(e);
  }
  deduped.sort((a, b) => a.ts - b.ts);

  // Build blocks: start at floor(first ts to the hour); new block when an entry
  // is >= 5h after the block start OR the gap since the previous entry is > 5h.
  let blockStart = null;
  let lastTs = null;
  let blockTokens = 0;
  let blockLatestTs = null;

  const blocks = [];
  const flush = () => {
    if (blockStart != null) {
      blocks.push({ start: blockStart, tokens: blockTokens, latestTs: blockLatestTs });
    }
  };

  for (const e of deduped) {
    if (
      blockStart == null ||
      e.ts >= blockStart + WINDOW_MS ||
      (lastTs != null && e.ts - lastTs > WINDOW_MS)
    ) {
      flush();
      blockStart = Math.floor(e.ts / HOUR_MS) * HOUR_MS;
      blockTokens = 0;
      blockLatestTs = e.ts;
    }
    blockTokens += countTokens(e.usage);
    blockLatestTs = e.ts;
    lastTs = e.ts;
  }
  flush();

  const idle = { active: false, usedTokens: 0, windowStart: null, resetAt: null };
  if (blocks.length === 0) return idle;

  const last = blocks[blocks.length - 1];
  // Active only if the window is still open (now before reset).
  if (now >= last.start + WINDOW_MS) return idle;
  return {
    active: true,
    usedTokens: last.tokens,
    windowStart: last.start,
    resetAt: last.start + WINDOW_MS,
  };
}

// --- Filesystem scan + cache (verified manually, not unit-tested) ---

function projectsDir() {
  return path.join(os.homedir(), ".claude", "projects");
}

function* walkJsonlFiles(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      yield* walkJsonlFiles(full);
    } else if (ent.isFile() && ent.name.endsWith(".jsonl")) {
      yield full;
    }
  }
}

function parseEntriesFromFile(file) {
  const out = [];
  let text;
  try {
    text = fs.readFileSync(file, "utf-8");
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = o.message;
    if (!msg || !msg.usage || !o.timestamp) continue;
    const ts = Date.parse(o.timestamp);
    if (Number.isNaN(ts)) continue;
    out.push({ ts, id: msg.id || null, usage: msg.usage });
  }
  return out;
}

let _cache = { at: 0, value: null };

/** Scan recent JSONL files and compute the active window. Cached for 30s. */
export function readWindow(now = Date.now()) {
  if (_cache.value && now - _cache.at < CACHE_TTL_MS) return _cache.value;
  const entries = [];
  const cutoff = now - SCAN_MAX_AGE_MS;
  for (const file of walkJsonlFiles(projectsDir())) {
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    if (stat.mtimeMs < cutoff) continue;
    for (const e of parseEntriesFromFile(file)) entries.push(e);
  }
  const value = computeWindow(entries, now);
  _cache = { at: now, value };
  return value;
}
