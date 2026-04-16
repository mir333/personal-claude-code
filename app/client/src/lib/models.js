// Dynamic model registry with localStorage persistence.
//
// Replaces the previous hardcoded MODEL_OPTIONS array. The list is fetched
// from the server's /api/models endpoint (which itself caches the result of
// Anthropic's /v1/models call for 1 hour). On the client we:
//
//   1. Hydrate immediately from localStorage so the UI never sees an empty
//      dropdown on a fresh page load.
//   2. Trigger a network refresh on app start.
//   3. Re-fetch every REFRESH_INTERVAL_MS (1 hour) to pick up new models.
//   4. Fall back to a hardcoded list as a last resort if both the cache and
//      the network are unavailable.
//
// Components consume the cache via the `useModels()` hook (see
// hooks/useModels.js) rather than importing a static array.

const STORAGE_KEY = "personal-claude-code:models-cache:v1";
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// Hardcoded last-resort fallback. Kept in sync with the server-side fallback.
const FALLBACK_MODELS = [
  { value: "claude-sonnet-4-5-20250929", label: "Sonnet 4.5", description: "Fast and capable. Great balance of speed and quality.", shortLabel: "sonnet-4.5" },
  { value: "claude-sonnet-4-20250514", label: "Sonnet 4", description: "Previous generation Sonnet. Reliable and efficient.", shortLabel: "sonnet-4" },
  { value: "claude-opus-4-20250514", label: "Opus 4", description: "Most capable model. Best for complex reasoning tasks.", shortLabel: "opus-4" },
  { value: "claude-haiku-3-5-20241022", label: "Haiku 3.5", description: "Fastest and most cost-effective. Good for simple tasks.", shortLabel: "haiku-3.5" },
];

function loadFromStorage() {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.models) || parsed.models.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveToStorage(payload) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota exceeded or storage disabled — silently ignore.
  }
}

// Initial state: hydrate from localStorage if available, else fallback.
const stored = loadFromStorage();
const state = {
  models: stored?.models || FALLBACK_MODELS,
  fetchedAt: stored?.fetchedAt || 0,
  source: stored?.source || (stored ? "localStorage" : "fallback"),
  loading: false,
};

const subscribers = new Set();

function notify() {
  for (const cb of subscribers) {
    try { cb(state); } catch (err) { console.error("[models] subscriber error:", err); }
  }
}

export function subscribe(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

export function getModelsState() {
  return state;
}

export function getModels() {
  return state.models;
}

let inflight = null;
let refreshTimer = null;

export async function loadModels({ force = false } = {}) {
  // Coalesce concurrent calls.
  if (inflight) return inflight;

  inflight = (async () => {
    state.loading = true;
    notify();
    try {
      const url = force ? "/api/models?refresh=1" : "/api/models";
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`/api/models returned ${resp.status}`);
      const json = await resp.json();
      if (!json || !Array.isArray(json.models) || json.models.length === 0) {
        throw new Error("Empty model list from server");
      }
      state.models = json.models;
      state.fetchedAt = json.fetchedAt || Date.now();
      state.source = json.source || "server";
      saveToStorage({ models: state.models, fetchedAt: state.fetchedAt, source: state.source });
    } catch (err) {
      console.warn("[models] loadModels failed; keeping current list:", err.message);
      // Keep whatever we already have (localStorage / fallback).
    } finally {
      state.loading = false;
      inflight = null;
      notify();
    }
    return state;
  })();

  return inflight;
}

// Start a 1-hour refresh interval. Idempotent — safe to call from React
// effects in StrictMode (double-invocation is a no-op).
export function startModelRefresh() {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    loadModels({ force: false }).catch(() => {});
  }, REFRESH_INTERVAL_MS);
}

export function stopModelRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

// --- Lookup helpers (drop-in replacements for the previous static helpers) ---

export function getModelLabel(modelValue) {
  if (!modelValue) return "Default";
  const opt = state.models.find((m) => m.value === modelValue);
  return opt ? opt.label : modelValue.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

export function getModelShortLabel(modelValue) {
  if (!modelValue) return "Default";
  const opt = state.models.find((m) => m.value === modelValue);
  return opt ? opt.shortLabel : modelValue.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

// Backwards-compat: a few callers may still import MODEL_OPTIONS. We expose
// it as a *getter* via an array proxy so existing `.map(...)` calls keep
// working while reflecting the live cache. Prefer useModels() in new code.
export const MODEL_OPTIONS = new Proxy([], {
  get(_target, prop) {
    const live = state.models;
    if (prop === "length") return live.length;
    if (prop === Symbol.iterator) return live[Symbol.iterator].bind(live);
    if (typeof prop === "string" && /^\d+$/.test(prop)) return live[Number(prop)];
    const v = live[prop];
    return typeof v === "function" ? v.bind(live) : v;
  },
});
