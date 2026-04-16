import crypto from "crypto";
import { createAgent, getAgent, deleteAgent } from "./agents.js";

// How long a session-agent can sit idle before we GC it.
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 min
// How often the sweeper runs.
const GC_INTERVAL_MS = 5 * 60 * 1000; // 5 min

/**
 * Registry: Map<cacheKey, {
 *   agentId, tokenId, sessionHash, workingDirectory, profileId, lastUsedAt
 * }>
 *
 * cacheKey = `${tokenId}::${sessionHash}` — namespaces sessions per-token so
 * two tokens bound to the same workingDirectory never share Claude SDK sessions.
 */
const registry = new Map();

function cacheKey(tokenId, sessionHash) {
  return `${tokenId}::${sessionHash}`;
}

/**
 * Canonicalize a single AI-SDK / OpenAI-shaped message into a stable
 * `{ role, content }` where content is a plain string.
 */
function canonicalizeMessage(m) {
  if (!m || typeof m !== "object") return { role: "user", content: "" };
  let content = "";
  if (typeof m.content === "string") {
    content = m.content;
  } else if (Array.isArray(m.content)) {
    content = m.content
      .filter((p) => p && (p.type === "text" || typeof p.text === "string"))
      .map((p) => p.text || "")
      .join("");
  }
  return { role: m.role || "user", content };
}

/**
 * Hash the prefix of the messages array. The LAST message is dropped because
 * it's the new user turn we're about to send — once the Claude SDK sessionId is
 * established, that turn is covered by session state, not by our cache key.
 *
 * Returns one of:
 *   - "empty" if messages is empty/invalid
 *   - "fresh" if there's exactly one message (a first-turn user prompt)
 *   - sha256 hex of the canonical prefix otherwise
 */
export function hashMessagesPrefix(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return "empty";
  const prefix = messages.slice(0, -1);
  if (prefix.length === 0) return "fresh";
  const canonical = prefix.map(canonicalizeMessage);
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/**
 * Look up an existing session-agent for (tokenId, sessionHash) or create one.
 * The agent runs in `workingDirectory` under `profileId`.
 */
export function acquireSessionAgent({ tokenId, sessionHash, workingDirectory, profileId, agentName }) {
  const key = cacheKey(tokenId, sessionHash);
  const existing = registry.get(key);
  if (existing) {
    const agent = getAgent(existing.agentId);
    if (agent && agent.workingDirectory === workingDirectory) {
      existing.lastUsedAt = Date.now();
      return agent;
    }
    // Stale (agent was GC'd or deleted elsewhere, or workspace path changed) — drop.
    registry.delete(key);
  }
  const agent = createAgent(agentName, workingDirectory, profileId);
  // API callers can't answer interactive questions — match task-run semantics.
  agent.interactiveQuestions = false;
  registry.set(key, {
    agentId: agent.id,
    tokenId,
    sessionHash,
    workingDirectory,
    profileId: profileId || null,
    lastUsedAt: Date.now(),
  });
  return agent;
}

/** Mark the (tokenId, sessionHash) entry as recently used, preventing idle GC. */
export function touchSessionAgent(tokenId, sessionHash) {
  const entry = registry.get(cacheKey(tokenId, sessionHash));
  if (entry) entry.lastUsedAt = Date.now();
}

/** Evict every session-agent for a given token. Called when the token is revoked. */
export function evictByTokenId(tokenId) {
  for (const [key, entry] of registry.entries()) {
    if (entry.tokenId === tokenId) {
      try { deleteAgent(entry.agentId); } catch {}
      registry.delete(key);
    }
  }
}

/** Drop stale entries whose underlying agent no longer exists. */
function reapStale() {
  for (const [key, entry] of registry.entries()) {
    if (!getAgent(entry.agentId)) {
      registry.delete(key);
    }
  }
}

/** Evict entries idle longer than IDLE_TIMEOUT_MS. */
function gcIdle() {
  const now = Date.now();
  for (const [key, entry] of registry.entries()) {
    if (now - entry.lastUsedAt > IDLE_TIMEOUT_MS) {
      try { deleteAgent(entry.agentId); } catch {}
      registry.delete(key);
    }
  }
}

// Periodic sweeper. .unref() so it never blocks process exit.
const sweeper = setInterval(() => {
  try { reapStale(); } catch (err) { console.error("[sessionAgents] reapStale failed:", err.message); }
  try { gcIdle(); } catch (err) { console.error("[sessionAgents] gcIdle failed:", err.message); }
}, GC_INTERVAL_MS);
if (typeof sweeper.unref === "function") sweeper.unref();
