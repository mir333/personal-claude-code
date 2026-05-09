import fs from "fs";
import path from "path";
import crypto from "crypto";

const PROFILES_DIR = "/home/node/.claude/profiles";
const LEGACY_DIR = "/home/node/.claude/git";
const ENV_VARS_FILENAME = "env-vars.json";

function envVarsPath(profileId) {
  if (profileId) {
    const dir = path.join(PROFILES_DIR, profileId);
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, ENV_VARS_FILENAME);
  }
  fs.mkdirSync(LEGACY_DIR, { recursive: true });
  return path.join(LEGACY_DIR, ENV_VARS_FILENAME);
}

function loadVars(profileId) {
  try {
    const raw = fs.readFileSync(envVarsPath(profileId), "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data.vars) ? data.vars : [];
  } catch {
    return [];
  }
}

function saveVars(profileId, vars) {
  const filePath = envVarsPath(profileId);
  const tmp = filePath + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ vars }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

// Validate env var name: must start with a letter or underscore, contain only
// uppercase letters, digits, and underscores.  We normalise to uppercase.
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * List all env vars for a profile.  Never exposes raw values.
 */
export function listEnvVars(profileId) {
  return loadVars(profileId).map(({ id, name, createdAt, updatedAt }) => ({
    id,
    name,
    hasValue: true,
    createdAt,
    updatedAt: updatedAt || null,
  }));
}

/**
 * Create or update an environment variable (upsert by name).
 * Name is normalised to uppercase.
 */
export function setEnvVar(profileId, { name, value }) {
  const trimmed = (name || "").trim().toUpperCase();
  if (!trimmed) throw new Error("Variable name is required");
  if (!NAME_RE.test(trimmed)) {
    throw new Error("Variable name must contain only letters, digits, and underscores, and start with a letter or underscore");
  }
  if (value == null || value === "") throw new Error("Variable value is required");

  const vars = loadVars(profileId);
  const existing = vars.find((v) => v.name === trimmed);

  if (existing) {
    existing.value = value;
    existing.updatedAt = Date.now();
  } else {
    vars.push({
      id: crypto.randomUUID(),
      name: trimmed,
      value,
      createdAt: Date.now(),
      updatedAt: null,
    });
  }

  saveVars(profileId, vars);
  const entry = existing || vars[vars.length - 1];
  return { id: entry.id, name: entry.name };
}

/**
 * Delete an environment variable by id.
 */
export function deleteEnvVar(profileId, varId) {
  const vars = loadVars(profileId);
  const next = vars.filter((v) => v.id !== varId);
  if (next.length === vars.length) return false;
  saveVars(profileId, next);
  return true;
}

/**
 * Load all env vars as a plain object suitable for passing to the SDK's
 * options.env.  Returns { NAME: "value", ... }.
 */
export function loadEnvVarsForAgent(profileId) {
  const vars = loadVars(profileId);
  const env = {};
  for (const v of vars) {
    env[v.name] = v.value;
  }
  return env;
}
