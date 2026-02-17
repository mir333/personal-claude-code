import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from "fs";
import path from "path";
import { randomBytes } from "crypto";

const STORAGE_DIR = ".claude-ui";
const STORAGE_FILE = "conversations.json";

/** Ensure .claude-ui is listed in the project's .gitignore */
function ensureGitignore(workDir) {
  const gitignorePath = path.join(workDir, ".gitignore");
  try {
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, "utf-8");
      if (content.split("\n").some((line) => line.trim() === STORAGE_DIR || line.trim() === `/${STORAGE_DIR}`)) {
        return; // already ignored
      }
      writeFileSync(gitignorePath, content.trimEnd() + "\n" + STORAGE_DIR + "\n");
    } else {
      writeFileSync(gitignorePath, STORAGE_DIR + "\n");
    }
  } catch {
    // non-critical, ignore
  }
}

function storagePath(workDir) {
  return path.join(workDir, STORAGE_DIR, STORAGE_FILE);
}

export function loadConversation(workDir) {
  try {
    const data = readFileSync(storagePath(workDir), "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export function saveConversation(workDir, entries) {
  const dir = path.join(workDir, STORAGE_DIR);
  const dirExisted = existsSync(dir);
  mkdirSync(dir, { recursive: true });
  if (!dirExisted) ensureGitignore(workDir);
  const filePath = storagePath(workDir);
  const tmpPath = filePath + "." + randomBytes(4).toString("hex") + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(entries, null, 2));
  renameSync(tmpPath, filePath);
}

export function appendEntry(workDir, entry) {
  const entries = loadConversation(workDir);
  entries.push(entry);
  saveConversation(workDir, entries);
}
