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

/**
 * Load the Resend API token for a profile. Returns the raw token string or null.
 */
export function loadResendToken(profileId) {
  try {
    const raw = fs.readFileSync(configPath(profileId), "utf-8");
    const data = JSON.parse(raw);
    return data.token || null;
  } catch {
    return null;
  }
}

/**
 * Save/update the Resend API token for a profile.
 */
export function saveResendToken(profileId, token) {
  const filePath = configPath(profileId);
  const tmp = filePath + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ token, updatedAt: Date.now() }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

/**
 * Delete the Resend API token for a profile.
 */
export function deleteResendToken(profileId) {
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
  return !!loadResendToken(profileId);
}
