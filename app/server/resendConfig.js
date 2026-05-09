import fs from "fs";
import path from "path";
import crypto from "crypto";

const PROFILES_DIR = "/home/node/.claude/profiles";
const CONFIG_FILENAME = "resend-config.json";

function configPath(profileId) {
  const dir = path.join(PROFILES_DIR, profileId);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, CONFIG_FILENAME);
}

function readRaw(profileId) {
  try {
    const raw = fs.readFileSync(configPath(profileId), "utf-8");
    const data = JSON.parse(raw);
    return typeof data === "object" && data !== null ? data : {};
  } catch {
    return null;
  }
}

function writeRaw(profileId, data) {
  const filePath = configPath(profileId);
  const tmp = filePath + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

/**
 * Load the full Resend config for a profile.
 * Returns { token, from } where each field may be null/undefined.
 */
export function loadResendConfig(profileId) {
  const data = readRaw(profileId);
  if (!data) return { token: null, from: null };
  return {
    token: data.token || null,
    from: data.from || null,
  };
}

/**
 * Save/update Resend config for a profile.  Accepts a partial { token?, from? }
 * and merges it into the existing config — fields that are explicitly set to
 * null or empty string are cleared, while undefined fields are left untouched.
 */
export function saveResendConfig(profileId, partial) {
  const existing = readRaw(profileId) || {};
  const next = { ...existing };

  if (Object.prototype.hasOwnProperty.call(partial, "token")) {
    if (partial.token == null || partial.token === "") delete next.token;
    else next.token = partial.token;
  }
  if (Object.prototype.hasOwnProperty.call(partial, "from")) {
    if (partial.from == null || partial.from === "") delete next.from;
    else next.from = partial.from;
  }
  next.updatedAt = Date.now();
  writeRaw(profileId, next);
}

/**
 * Delete the Resend config for a profile.
 */
export function deleteResendConfig(profileId) {
  try {
    fs.unlinkSync(configPath(profileId));
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a Resend token is configured (without returning the value).
 */
export function hasResendToken(profileId) {
  return !!loadResendConfig(profileId).token;
}
