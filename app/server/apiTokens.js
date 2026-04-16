import fs from "fs";
import path from "path";
import crypto from "crypto";

const PROFILES_DIR = "/home/node/.claude/profiles";
const LEGACY_DIR = "/home/node/.claude/git";
const TOKENS_FILENAME = "api-tokens.json";

function tokensPath(profileId) {
  if (profileId) {
    const dir = path.join(PROFILES_DIR, profileId);
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, TOKENS_FILENAME);
  }
  fs.mkdirSync(LEGACY_DIR, { recursive: true });
  return path.join(LEGACY_DIR, TOKENS_FILENAME);
}

function loadTokens(profileId) {
  try {
    const raw = fs.readFileSync(tokensPath(profileId), "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data.tokens) ? data.tokens : [];
  } catch {
    return [];
  }
}

function saveTokens(profileId, tokens) {
  const filePath = tokensPath(profileId);
  const tmp = filePath + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ tokens }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token, "utf-8").digest("hex");
}

/**
 * List all tokens for a profile. Does not expose the raw token value.
 */
export function listApiTokens(profileId) {
  return loadTokens(profileId).map(({ id, label, agentId, createdAt, lastUsedAt }) => ({
    id,
    label,
    agentId: agentId || null,
    createdAt,
    lastUsedAt: lastUsedAt || null,
  }));
}

/**
 * Create a new API token. Returns the raw token string ONCE. It cannot be retrieved again.
 */
export function createApiToken(profileId, { label, agentId }) {
  const trimmedLabel = (label || "").trim();
  if (!trimmedLabel) throw new Error("Label is required");
  if (!agentId) throw new Error("agentId is required");

  const tokens = loadTokens(profileId);

  // Generate a long random token. Prefix makes it identifiable.
  const rawToken = "pcc_" + crypto.randomBytes(32).toString("hex");
  const id = crypto.randomUUID();

  const entry = {
    id,
    label: trimmedLabel,
    agentId,
    tokenHash: hashToken(rawToken),
    createdAt: Date.now(),
    lastUsedAt: null,
  };

  tokens.push(entry);
  saveTokens(profileId, tokens);

  return {
    id,
    label: trimmedLabel,
    agentId,
    token: rawToken, // only returned on creation
    createdAt: entry.createdAt,
  };
}

/**
 * Delete a token by id.
 */
export function deleteApiToken(profileId, tokenId) {
  const tokens = loadTokens(profileId);
  const next = tokens.filter((t) => t.id !== tokenId);
  if (next.length === tokens.length) return false;
  saveTokens(profileId, next);
  return true;
}

/**
 * Resolve a raw bearer token to its entry. Searches across ALL profiles,
 * since API clients authenticate only by the token string.
 *
 * Returns { profileId, id, label, agentId } or null.
 * Also updates lastUsedAt.
 */
export function resolveApiToken(rawToken) {
  if (!rawToken || typeof rawToken !== "string") return null;
  const h = hashToken(rawToken);

  // Build the list of candidate profile directories
  const candidates = [];
  try {
    const entries = fs.readdirSync(PROFILES_DIR, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) candidates.push(e.name);
    }
  } catch {
    // no profiles dir
  }
  // Also the legacy (no-profile) bucket
  candidates.push(null);

  for (const profileId of candidates) {
    const tokens = loadTokens(profileId);
    const found = tokens.find((t) => t.tokenHash === h);
    if (found) {
      // Best-effort update of lastUsedAt
      found.lastUsedAt = Date.now();
      try { saveTokens(profileId, tokens); } catch {}
      return {
        profileId,
        id: found.id,
        label: found.label,
        agentId: found.agentId,
      };
    }
  }
  return null;
}
