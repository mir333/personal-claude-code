import { readFileSync, writeFileSync, mkdirSync, renameSync } from "fs";
import path from "path";
import { randomBytes } from "crypto";

const STORAGE_DIR = ".claude-ui";
const STORAGE_FILE = "conversations.json";

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
  mkdirSync(dir, { recursive: true });
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
