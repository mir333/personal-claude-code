import fs from "fs";
import path from "path";
import crypto from "crypto";

// --- Storage paths ---

function getSuggestionsDir(profileId) {
  return path.join("/home/node/.claude/profiles", profileId);
}

function getSuggestionsPath(profileId) {
  return path.join(getSuggestionsDir(profileId), "suggestions.json");
}

// --- In-memory state ---
const suggestionsCache = new Map(); // profileId -> suggestion[]

// --- Known context tags ---
export const KNOWN_CONTEXT_TAGS = [
  "after_completion",
  "after_error",
  "after_context_cleared",
  "git",
  "has_pr",
  "has_review_content",
  "has_bash_calls",
  "recovery",
  "fresh_start",
];

// --- Default suggestions (seeded for new profiles) ---

const DEFAULT_SUGGESTIONS = [
  {
    name: "Continue",
    description: "Continue with the current task",
    actionType: "prompt",
    actionValue: "Continue",
    contextTags: ["after_completion"],
    order: 10,
  },
  {
    name: "Summarize changes",
    description: "Summarize all changes made so far",
    actionType: "prompt",
    actionValue: "Summarize changes",
    contextTags: ["after_completion"],
    order: 20,
  },
  {
    name: "Commit changes",
    description: "Stage and commit all current changes with a descriptive message",
    actionType: "prompt",
    actionValue: "Commit changes",
    contextTags: ["after_completion", "git"],
    order: 30,
  },
  {
    name: "Push code",
    description: "Push committed changes to the remote repository",
    actionType: "prompt",
    actionValue: "Push code",
    contextTags: ["after_completion", "git"],
    order: 40,
  },
  {
    name: "Git Status",
    description: "Check the current git status of the repository",
    actionType: "prompt",
    actionValue: "Git Status",
    contextTags: ["after_completion", "git"],
    order: 50,
  },
  {
    name: "Git Push",
    description: "Push all changes to the remote branch",
    actionType: "prompt",
    actionValue: "Git Push",
    contextTags: ["after_completion", "git"],
    order: 60,
  },
  {
    name: "Review {{prLabel}}",
    description: "Review the current pull/merge request",
    actionType: "prompt",
    actionValue: "Review {{prLabel}}",
    contextTags: ["after_completion", "has_pr"],
    order: 70,
  },
  {
    name: "Post review to {{prLabel}}",
    description: "Post the assistant's analysis as a review comment on the pull/merge request",
    actionType: "platform",
    actionValue: "post-pr-review",
    contextTags: ["after_completion", "has_pr", "has_review_content"],
    order: 80,
  },
  {
    name: "Run tests",
    description: "Run the project's test suite",
    actionType: "prompt",
    actionValue: "Run tests",
    contextTags: ["after_completion", "has_bash_calls"],
    order: 90,
  },
  {
    name: "Try again",
    description: "Retry the last operation that failed",
    actionType: "prompt",
    actionValue: "Try again",
    contextTags: ["after_error", "recovery"],
    order: 10,
  },
  {
    name: "Explain the error",
    description: "Ask for a detailed explanation of what went wrong",
    actionType: "prompt",
    actionValue: "Explain the error",
    contextTags: ["after_error", "recovery"],
    order: 20,
  },
  {
    name: "Start fresh",
    description: "Begin a new conversation from scratch",
    actionType: "prompt",
    actionValue: "Start fresh",
    contextTags: ["after_context_cleared", "fresh_start"],
    order: 10,
  },
];

// --- Storage helpers ---

function loadFromDisk(profileId) {
  try {
    const data = JSON.parse(fs.readFileSync(getSuggestionsPath(profileId), "utf-8"));
    return data.suggestions || [];
  } catch {
    return [];
  }
}

function persistToDisk(profileId) {
  const items = suggestionsCache.get(profileId) || [];
  const dir = getSuggestionsDir(profileId);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = getSuggestionsPath(profileId) + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify({ suggestions: items }, null, 2));
  fs.renameSync(tmpPath, getSuggestionsPath(profileId));
}

function seedDefaults(profileId) {
  const now = Date.now();
  const defaults = DEFAULT_SUGGESTIONS.map((s) => ({
    id: crypto.randomUUID(),
    ...s,
    enabled: true,
    builtIn: true,
    createdAt: now,
    updatedAt: now,
  }));
  suggestionsCache.set(profileId, defaults);
  persistToDisk(profileId);
}

// --- Initialization ---

export function initSuggestions(profileId) {
  if (!profileId) return;
  if (suggestionsCache.has(profileId)) return; // already loaded

  if (!fs.existsSync(getSuggestionsPath(profileId))) {
    seedDefaults(profileId);
  } else {
    const items = loadFromDisk(profileId);
    suggestionsCache.set(profileId, items);
  }
}

// --- CRUD ---

export function listSuggestions(profileId) {
  if (!profileId) return [];
  initSuggestions(profileId);
  const items = suggestionsCache.get(profileId) || [];
  return [...items].sort((a, b) => a.order - b.order);
}

export function getSuggestion(profileId, id) {
  if (!profileId) return null;
  initSuggestions(profileId);
  const items = suggestionsCache.get(profileId) || [];
  return items.find((s) => s.id === id) || null;
}

export function createSuggestion(profileId, config) {
  if (!profileId) throw new Error("profileId is required");
  initSuggestions(profileId);

  const items = suggestionsCache.get(profileId) || [];
  const now = Date.now();

  // Auto-assign order: max existing + 10
  const maxOrder = items.reduce((max, s) => Math.max(max, s.order), 0);

  const suggestion = {
    id: crypto.randomUUID(),
    name: config.name,
    description: config.description || "",
    actionType: config.actionType,
    actionValue: config.actionValue,
    contextTags: config.contextTags || [],
    order: config.order !== undefined ? config.order : maxOrder + 10,
    enabled: config.enabled !== undefined ? config.enabled : true,
    builtIn: false,
    createdAt: now,
    updatedAt: now,
  };

  items.push(suggestion);
  suggestionsCache.set(profileId, items);
  persistToDisk(profileId);
  return suggestion;
}

export function updateSuggestion(profileId, id, updates) {
  if (!profileId) return null;
  initSuggestions(profileId);

  const items = suggestionsCache.get(profileId) || [];
  const index = items.findIndex((s) => s.id === id);
  if (index === -1) return null;

  const suggestion = items[index];

  if (updates.name !== undefined) suggestion.name = updates.name;
  if (updates.description !== undefined) suggestion.description = updates.description;
  if (updates.actionType !== undefined) suggestion.actionType = updates.actionType;
  if (updates.actionValue !== undefined) suggestion.actionValue = updates.actionValue;
  if (updates.contextTags !== undefined) suggestion.contextTags = updates.contextTags;
  if (updates.order !== undefined) suggestion.order = updates.order;
  if (updates.enabled !== undefined) suggestion.enabled = updates.enabled;
  suggestion.updatedAt = Date.now();

  items[index] = suggestion;
  suggestionsCache.set(profileId, items);
  persistToDisk(profileId);
  return suggestion;
}

export function deleteSuggestion(profileId, id) {
  if (!profileId) return false;
  initSuggestions(profileId);

  const items = suggestionsCache.get(profileId) || [];
  const index = items.findIndex((s) => s.id === id);
  if (index === -1) return false;

  // Built-in suggestions cannot be deleted, only disabled
  if (items[index].builtIn) {
    return false;
  }

  items.splice(index, 1);
  suggestionsCache.set(profileId, items);
  persistToDisk(profileId);
  return true;
}

export function reorderSuggestions(profileId, orderedIds) {
  if (!profileId) return [];
  initSuggestions(profileId);

  const items = suggestionsCache.get(profileId) || [];
  const idToItem = new Map(items.map((s) => [s.id, s]));

  // Assign new order values based on position in orderedIds
  orderedIds.forEach((id, index) => {
    const item = idToItem.get(id);
    if (item) {
      item.order = (index + 1) * 10;
      item.updatedAt = Date.now();
    }
  });

  suggestionsCache.set(profileId, items);
  persistToDisk(profileId);
  return listSuggestions(profileId);
}
