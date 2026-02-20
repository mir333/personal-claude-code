import fs from "fs";
import path from "path";
import crypto from "crypto";

const PROFILES_DIR = "/home/node/.claude/profiles";
const PROFILES_FILE = path.join(PROFILES_DIR, "profiles.json");

fs.mkdirSync(PROFILES_DIR, { recursive: true });

// --- Helpers ---

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, storedHash) {
  const { hash } = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(storedHash, "hex"));
}

// --- Storage ---

function loadProfiles() {
  try {
    const data = JSON.parse(fs.readFileSync(PROFILES_FILE, "utf-8"));
    return data.profiles || [];
  } catch {
    return [];
  }
}

function saveProfiles(profiles) {
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
  const tmpPath = PROFILES_FILE + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify({ profiles }, null, 2));
  fs.renameSync(tmpPath, PROFILES_FILE);
}

// --- Public API ---

export function profilesExist() {
  return loadProfiles().length > 0;
}

export function listProfiles() {
  return loadProfiles().map(({ id, name, slug, createdAt }) => ({
    id,
    name,
    slug,
    createdAt,
  }));
}

export function getProfile(profileId) {
  const profiles = loadProfiles();
  const p = profiles.find((p) => p.id === profileId);
  if (!p) return null;
  return { id: p.id, name: p.name, slug: p.slug, createdAt: p.createdAt };
}

export function createProfile(name, password) {
  if (!name || name.trim().length < 2) {
    throw new Error("Name must be at least 2 characters");
  }
  if (!password || password.length < 4) {
    throw new Error("Password must be at least 4 characters");
  }

  const profiles = loadProfiles();

  // Check for duplicate name (case-insensitive)
  const normalizedName = name.trim();
  if (profiles.some((p) => p.name.toLowerCase() === normalizedName.toLowerCase())) {
    throw new Error("A profile with this name already exists");
  }

  // Generate unique slug
  let slug = slugify(normalizedName);
  if (!slug) slug = "user";
  let finalSlug = slug;
  let counter = 1;
  while (profiles.some((p) => p.slug === finalSlug)) {
    finalSlug = `${slug}-${counter++}`;
  }

  const id = crypto.randomUUID();
  const { salt, hash } = hashPassword(password);

  const profile = {
    id,
    name: normalizedName,
    slug: finalSlug,
    salt,
    passwordHash: hash,
    createdAt: Date.now(),
  };

  profiles.push(profile);
  saveProfiles(profiles);

  // Create profile directories
  initializeProfileDirs(id);

  // Create workspace root
  const workspaceRoot = getProfilePaths(id).workspaceRoot;
  fs.mkdirSync(workspaceRoot, { recursive: true });

  return { id, name: profile.name, slug: finalSlug, createdAt: profile.createdAt };
}

export function verifyProfile(profileId, password) {
  const profiles = loadProfiles();
  const profile = profiles.find((p) => p.id === profileId);
  if (!profile) return false;
  try {
    return verifyPassword(password, profile.salt, profile.passwordHash);
  } catch {
    return false;
  }
}

export function getProfilePaths(profileId) {
  const profiles = loadProfiles();
  const profile = profiles.find((p) => p.id === profileId);
  if (!profile) return null;

  return {
    gitDir: path.join(PROFILES_DIR, profileId, "git"),
    workspaceRoot: `/workspace/${profile.slug}`,
  };
}

function initializeProfileDirs(profileId) {
  const gitDir = path.join(PROFILES_DIR, profileId, "git");
  fs.mkdirSync(gitDir, { recursive: true });

  // Create empty git config files if they don't exist
  const providersPath = path.join(gitDir, "providers.json");
  if (!fs.existsSync(providersPath)) {
    fs.writeFileSync(providersPath, "{}", { mode: 0o600 });
  }

  const credentialsPath = path.join(gitDir, "git-credentials");
  if (!fs.existsSync(credentialsPath)) {
    fs.writeFileSync(credentialsPath, "", { mode: 0o600 });
  }

  const gitconfigPath = path.join(gitDir, "gitconfig");
  if (!fs.existsSync(gitconfigPath)) {
    fs.writeFileSync(gitconfigPath, "", { mode: 0o600 });
  }
}
