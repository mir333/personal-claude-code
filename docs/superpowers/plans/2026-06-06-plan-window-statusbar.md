# Plan-Window Status Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the current 5-hour Claude plan-window token usage vs the selected plan limit, plus a reset countdown, in the web UI status bar.

**Architecture:** A server module reads `~/.claude/projects/**/*.jsonl`, dedupes by message id, groups entries into 5-hour blocks, and returns the active window's token total + reset time (pure `computeWindow` for testing, fs wrapper `readWindow` with a 30s cache). A per-profile `usage-plan.json` holds the plan; three API routes expose window + plan get/set. The client polls a hook and renders a colored bar + live countdown in `StatusBar`, with a plan selector tab in the Settings panel.

**Tech Stack:** Node 22 (ESM, `node --test`), Express 5, React 19 + Vite, Tailwind, lucide-react. No new dependencies.

---

## File Structure

Server:
- `app/server/usageWindow.js` (new) — `computeWindow(entries, now)` pure logic, `readWindow(now?)` fs scan + 30s cache, `countTokens(usage)` helper, `WINDOW_MS` const.
- `app/server/usageWindow.test.js` (new) — pure-logic tests.
- `app/server/usagePlan.js` (new) — `loadUsagePlan`/`saveUsagePlan`, `PLAN_LIMITS`, `PLANS`.
- `app/server/index.js` (modify) — `GET /api/usage/window`, `GET /api/usage-plan`, `POST /api/usage-plan`.

Client:
- `app/client/src/hooks/useUsageWindow.js` (new) — polls `/api/usage/window`.
- `app/client/src/components/StatusBar.jsx` (modify) — window segment + countdown child.
- `app/client/src/App.jsx` (modify) — wire hook into StatusBar.
- `app/client/src/components/Sidebar.jsx` (modify) — "Plan" settings tab.

Test command (from `app/`): `node --test ./server/*.test.js`

---

## Task 1: Window calculator core (pure logic)

**Files:**
- Create: `app/server/usageWindow.js`
- Test: `app/server/usageWindow.test.js`

- [ ] **Step 1: Write the failing tests**

Create `app/server/usageWindow.test.js`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeWindow, countTokens, WINDOW_MS } from "./usageWindow.js";

const HOUR = 3600_000;
// A fixed "now" on an arbitrary day; entries are expressed relative to it.
const NOW = Date.parse("2026-06-06T12:30:00.000Z");

function entry(tsMs, id, usage) {
  return { ts: tsMs, id, usage };
}
function u(input, output, cacheCreation = 0, cacheRead = 0) {
  return {
    input_tokens: input,
    output_tokens: output,
    cache_creation_input_tokens: cacheCreation,
    cache_read_input_tokens: cacheRead,
  };
}

test("countTokens sums input+output+cache_creation, excludes cache_read", () => {
  assert.equal(countTokens(u(10, 5, 3, 1000)), 18);
});

test("single recent block sums tokens and sets resetAt = blockStart + 5h", () => {
  const entries = [
    entry(NOW - 90 * 60_000, "a", u(100, 50)),
    entry(NOW - 30 * 60_000, "b", u(200, 25)),
  ];
  const w = computeWindow(entries, NOW);
  assert.equal(w.active, true);
  assert.equal(w.usedTokens, 375);
  // block start = floor(first ts to the hour)
  const blockStart = Math.floor((NOW - 90 * 60_000) / HOUR) * HOUR;
  assert.equal(w.windowStart, blockStart);
  assert.equal(w.resetAt, blockStart + WINDOW_MS);
});

test("entries older than 5h from the active block are excluded", () => {
  const entries = [
    entry(NOW - 7 * HOUR, "old", u(999, 999)), // belongs to an earlier block
    entry(NOW - 1 * HOUR, "new", u(100, 0)),
  ];
  const w = computeWindow(entries, NOW);
  assert.equal(w.usedTokens, 100);
});

test("a >5h gap starts a new block; only the active block counts", () => {
  const entries = [
    entry(NOW - 10 * HOUR, "x", u(500, 0)),
    entry(NOW - 9 * HOUR, "y", u(500, 0)),
    entry(NOW - 30 * 60_000, "z", u(40, 10)),
  ];
  const w = computeWindow(entries, NOW);
  assert.equal(w.usedTokens, 50);
});

test("duplicate message id counted once", () => {
  const entries = [
    entry(NOW - 20 * 60_000, "dup", u(100, 0)),
    entry(NOW - 19 * 60_000, "dup", u(100, 0)),
  ];
  const w = computeWindow(entries, NOW);
  assert.equal(w.usedTokens, 100);
});

test("idle when latest entry is older than 5h", () => {
  const entries = [entry(NOW - 6 * HOUR, "a", u(100, 100))];
  const w = computeWindow(entries, NOW);
  assert.equal(w.active, false);
  assert.equal(w.usedTokens, 0);
  assert.equal(w.windowStart, null);
  assert.equal(w.resetAt, null);
});

test("empty input is idle", () => {
  const w = computeWindow([], NOW);
  assert.equal(w.active, false);
  assert.equal(w.usedTokens, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && node --test ./server/usageWindow.test.js`
Expected: FAIL — `Cannot find module './usageWindow.js'`.

- [ ] **Step 3: Implement the pure core (and fs wrapper stub)**

Create `app/server/usageWindow.js`:

```javascript
import fs from "fs";
import path from "path";
import os from "os";

export const WINDOW_MS = 5 * 60 * 60 * 1000; // 5 hours
const HOUR_MS = 60 * 60 * 1000;
const SCAN_MAX_AGE_MS = 6 * 60 * 60 * 1000; // only parse files touched in last 6h
const CACHE_TTL_MS = 30_000;

/** Counted token measure: input + output + cache_creation (excludes cache_read). */
export function countTokens(usage) {
  if (!usage) return 0;
  return (
    (usage.input_tokens || 0) +
    (usage.output_tokens || 0) +
    (usage.cache_creation_input_tokens || 0)
  );
}

/**
 * Pure: given parsed entries [{ ts (ms), id, usage }] and `now` (ms), group into
 * 5-hour blocks and return the active window.
 * Returns { active, usedTokens, windowStart, resetAt }.
 */
export function computeWindow(entries, now) {
  // Dedup by message id (keep first occurrence).
  const seen = new Set();
  const deduped = [];
  for (const e of entries) {
    if (e.id != null) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
    }
    deduped.push(e);
  }
  deduped.sort((a, b) => a.ts - b.ts);

  // Build blocks: start at floor(first ts to the hour); new block when an entry
  // is >= 5h after the block start OR the gap since the previous entry is > 5h.
  let blockStart = null;
  let lastTs = null;
  let blockTokens = 0;
  let blockLatestTs = null;

  const blocks = [];
  const flush = () => {
    if (blockStart != null) {
      blocks.push({ start: blockStart, tokens: blockTokens, latestTs: blockLatestTs });
    }
  };

  for (const e of deduped) {
    if (
      blockStart == null ||
      e.ts >= blockStart + WINDOW_MS ||
      (lastTs != null && e.ts - lastTs > WINDOW_MS)
    ) {
      flush();
      blockStart = Math.floor(e.ts / HOUR_MS) * HOUR_MS;
      blockTokens = 0;
      blockLatestTs = e.ts;
    }
    blockTokens += countTokens(e.usage);
    blockLatestTs = e.ts;
    lastTs = e.ts;
  }
  flush();

  const idle = { active: false, usedTokens: 0, windowStart: null, resetAt: null };
  if (blocks.length === 0) return idle;

  const last = blocks[blocks.length - 1];
  // Active only if the window is still open (now before reset).
  if (now >= last.start + WINDOW_MS) return idle;
  return {
    active: true,
    usedTokens: last.tokens,
    windowStart: last.start,
    resetAt: last.start + WINDOW_MS,
  };
}

// --- Filesystem scan + cache (verified manually, not unit-tested) ---

function projectsDir() {
  return path.join(os.homedir(), ".claude", "projects");
}

function* walkJsonlFiles(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      yield* walkJsonlFiles(full);
    } else if (ent.isFile() && ent.name.endsWith(".jsonl")) {
      yield full;
    }
  }
}

function parseEntriesFromFile(file) {
  const out = [];
  let text;
  try {
    text = fs.readFileSync(file, "utf-8");
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = o.message;
    if (!msg || !msg.usage || !o.timestamp) continue;
    const ts = Date.parse(o.timestamp);
    if (Number.isNaN(ts)) continue;
    out.push({ ts, id: msg.id || null, usage: msg.usage });
  }
  return out;
}

let _cache = { at: 0, value: null };

/** Scan recent JSONL files and compute the active window. Cached for 30s. */
export function readWindow(now = Date.now()) {
  if (_cache.value && now - _cache.at < CACHE_TTL_MS) return _cache.value;
  const entries = [];
  const cutoff = now - SCAN_MAX_AGE_MS;
  for (const file of walkJsonlFiles(projectsDir())) {
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    if (stat.mtimeMs < cutoff) continue;
    for (const e of parseEntriesFromFile(file)) entries.push(e);
  }
  const value = computeWindow(entries, now);
  _cache = { at: now, value };
  return value;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && node --test ./server/usageWindow.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Smoke-test readWindow against live data**

Run: `cd app && node -e "import('./server/usageWindow.js').then(m=>console.log(JSON.stringify(m.readWindow())))"`
Expected: prints a JSON object with `active` and `usedTokens` fields (values depend on recent activity; no crash).

- [ ] **Step 6: Commit**

```bash
git add app/server/usageWindow.js app/server/usageWindow.test.js
git commit -m "feat: add 5-hour plan-window usage calculator"
```

---

## Task 2: Per-profile plan config

**Files:**
- Create: `app/server/usagePlan.js`
- Test: `app/server/usagePlan.test.js`

- [ ] **Step 1: Write the failing test**

Create `app/server/usagePlan.test.js`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { PLAN_LIMITS, PLANS, normalizePlanId } from "./usagePlan.js";

test("PLAN_LIMITS has pro/max5/max20 with expected values", () => {
  assert.equal(PLAN_LIMITS.pro, 19000);
  assert.equal(PLAN_LIMITS.max5, 88000);
  assert.equal(PLAN_LIMITS.max20, 220000);
});

test("PLANS lists all plans with id/label/limit", () => {
  assert.equal(PLANS.length, 3);
  for (const p of PLANS) {
    assert.ok(p.id && p.label);
    assert.equal(p.limit, PLAN_LIMITS[p.id]);
  }
});

test("normalizePlanId defaults unknown to max5", () => {
  assert.equal(normalizePlanId("bogus"), "max5");
  assert.equal(normalizePlanId(undefined), "max5");
  assert.equal(normalizePlanId("pro"), "pro");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && node --test ./server/usagePlan.test.js`
Expected: FAIL — `Cannot find module './usagePlan.js'`.

- [ ] **Step 3: Implement the module**

Create `app/server/usagePlan.js`:

```javascript
import fs from "fs";
import path from "path";
import crypto from "crypto";

const PROFILES_DIR = "/home/node/.claude/profiles";
const CONFIG_FILENAME = "usage-plan.json";

export const PLAN_LIMITS = { pro: 19000, max5: 88000, max20: 220000 };
export const PLANS = [
  { id: "pro", label: "Pro", limit: PLAN_LIMITS.pro },
  { id: "max5", label: "Max5", limit: PLAN_LIMITS.max5 },
  { id: "max20", label: "Max20", limit: PLAN_LIMITS.max20 },
];
const DEFAULT_PLAN = "max5";

export function normalizePlanId(planId) {
  return PLAN_LIMITS[planId] != null ? planId : DEFAULT_PLAN;
}

function configPath(profileId) {
  const dir = path.join(PROFILES_DIR, profileId || "_global");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, CONFIG_FILENAME);
}

export function loadUsagePlan(profileId) {
  try {
    const data = JSON.parse(fs.readFileSync(configPath(profileId), "utf-8"));
    return { planId: normalizePlanId(data.planId) };
  } catch {
    return { planId: DEFAULT_PLAN };
  }
}

export function saveUsagePlan(profileId, { planId }) {
  const next = { planId: normalizePlanId(planId), updatedAt: Date.now() };
  const filePath = configPath(profileId);
  const tmp = filePath + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, filePath);
  return next;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && node --test ./server/usagePlan.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/server/usagePlan.js app/server/usagePlan.test.js
git commit -m "feat: add per-profile plan limit config"
```

---

## Task 3: API routes

**Files:**
- Modify: `app/server/index.js`

- [ ] **Step 1: Add imports**

In `app/server/index.js`, find the existing usage import (`import { getUsageStats } from "./usage.js";`, near line 29) and add directly below it:

```javascript
import { readWindow } from "./usageWindow.js";
import { loadUsagePlan, saveUsagePlan, PLAN_LIMITS, PLANS, normalizePlanId } from "./usagePlan.js";
```

- [ ] **Step 2: Add the routes**

In `app/server/index.js`, find the existing usage route:

```javascript
app.get("/api/usage", (req, res) => {
```

Immediately ABOVE that line, insert:

```javascript
app.get("/api/usage/window", (req, res) => {
  const profileId = req.profile?.id || null;
  const { planId } = loadUsagePlan(profileId);
  const limit = PLAN_LIMITS[planId];
  const w = readWindow();
  res.json({ ...w, planId, limit });
});

app.get("/api/usage-plan", (req, res) => {
  const profileId = req.profile?.id || null;
  const { planId } = loadUsagePlan(profileId);
  res.json({ planId, limit: PLAN_LIMITS[planId], plans: PLANS });
});

app.post("/api/usage-plan", (req, res) => {
  const profileId = req.profile?.id || null;
  const planId = normalizePlanId(req.body?.planId);
  saveUsagePlan(profileId, { planId });
  res.json({ planId, limit: PLAN_LIMITS[planId], plans: PLANS });
});

```

- [ ] **Step 3: Syntax-check and smoke-test the route handler**

Run: `cd app && node --check ./server/index.js && echo "index.js OK"`
Expected: prints `index.js OK`.

- [ ] **Step 4: Commit**

```bash
git add app/server/index.js
git commit -m "feat: add usage window and plan API routes"
```

---

## Task 4: Client hook

**Files:**
- Create: `app/client/src/hooks/useUsageWindow.js`

- [ ] **Step 1: Implement the hook**

Create `app/client/src/hooks/useUsageWindow.js`:

```javascript
import { useState, useEffect, useCallback } from "react";

const EMPTY = { active: false, usedTokens: 0, limit: 88000, planId: "max5", windowStart: null, resetAt: null };

export function useUsageWindow(intervalMs = 60_000) {
  const [window, setWindow] = useState(EMPTY);

  const refresh = useCallback(() => {
    fetch("/api/usage/window")
      .then((r) => (r.ok ? r.json() : EMPTY))
      .then(setWindow)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);

  return { window, refresh };
}
```

- [ ] **Step 2: Commit**

```bash
git add app/client/src/hooks/useUsageWindow.js
git commit -m "feat: add useUsageWindow hook"
```

---

## Task 5: StatusBar segment + countdown

**Files:**
- Modify: `app/client/src/components/StatusBar.jsx`

- [ ] **Step 1: Add a window-color helper and a countdown component**

In `app/client/src/components/StatusBar.jsx`, add the import for the icon and the
two helpers near the top. Change the lucide import line (line 1) to add `Hourglass`:

```javascript
import { Activity, Coins, ArrowDownToLine, ArrowUpFromLine, Database, CalendarDays, Gauge, AlertTriangle, Eraser, Minimize2, Hourglass } from "lucide-react";
import { useState, useEffect } from "react";
```

Then, after the existing `contextColor` function, add:

```javascript
function windowColor(pct) {
  if (pct >= 90) return "bg-red-500";
  if (pct >= 70) return "bg-yellow-500";
  return "bg-green-500";
}

function formatCountdown(ms) {
  if (ms <= 0) return "0m";
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

function ResetCountdown({ resetAt }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span>resets in {formatCountdown(resetAt - now)}</span>;
}
```

- [ ] **Step 2: Accept the `window` prop and render the segment**

Change the component signature:

```javascript
export default function StatusBar({ usage, connected, contextInfo, planWindow, onClearContext, onCompact, className }) {
```

Then, immediately after the closing `)}` of the `{contextInfo && ( ... )}` block
(the line right before `{/* Consumption stats - hidden on mobile */}`), insert:

```jsx
      {planWindow && (() => {
        const limit = planWindow.limit || 1;
        const pct = planWindow.active ? Math.min(100, (planWindow.usedTokens / limit) * 100) : 0;
        return (
          <>
            <Separator orientation="vertical" className="h-3 shrink-0" />
            <span
              className="flex items-center gap-1.5 shrink-0"
              title={`Plan ${planWindow.planId}: ${formatTokens(planWindow.usedTokens)} / ${formatTokens(limit)} tokens in the current 5-hour window (${pct.toFixed(0)}%)`}
            >
              <Hourglass className="h-3 w-3" />
              <span className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                <span
                  className={`block h-full rounded-full transition-all ${windowColor(pct)}`}
                  style={{ width: `${pct}%` }}
                />
              </span>
              <span>{formatTokens(planWindow.usedTokens)}/{formatTokens(limit)}</span>
              {planWindow.active && planWindow.resetAt
                ? <span className="text-muted-foreground/70"><ResetCountdown resetAt={planWindow.resetAt} /></span>
                : <span className="text-muted-foreground/70">idle</span>}
            </span>
          </>
        );
      })()}
```

- [ ] **Step 3: Verify the client builds**

Run: `cd app && npm run build`
Expected: `built in ...` with no errors.

- [ ] **Step 4: Commit**

```bash
git add app/client/src/components/StatusBar.jsx
git commit -m "feat: render plan-window usage and reset countdown in status bar"
```

---

## Task 6: Wire the hook into App

**Files:**
- Modify: `app/client/src/App.jsx`

- [ ] **Step 1: Import and call the hook**

In `app/client/src/App.jsx`, find:

```javascript
import { useUsageStats } from "./hooks/useUsageStats.js";
```
Add below it:
```javascript
import { useUsageWindow } from "./hooks/useUsageWindow.js";
```

Find:
```javascript
  const { usage, refresh: refreshUsage } = useUsageStats();
```
Add below it:
```javascript
  const { window: planWindow } = useUsageWindow();
```

- [ ] **Step 2: Pass the prop to StatusBar**

Find the `<StatusBar` usage (near line 1046) and add the `planWindow` prop:

```jsx
          <StatusBar
            usage={usage}
            connected={connected}
            contextInfo={contextInfo}
            planWindow={planWindow}
            onClearContext={selectedAgentId ? handleClearContext : null}
            onCompact={selectedAgentId ? handleCompact : null}
            className="flex-1 border-b-0"
          />
```

- [ ] **Step 3: Verify the client builds**

Run: `cd app && npm run build`
Expected: `built in ...` with no errors.

- [ ] **Step 4: Commit**

```bash
git add app/client/src/App.jsx
git commit -m "feat: wire plan-window hook into status bar"
```

---

## Task 7: Plan selector in Settings

**Files:**
- Modify: `app/client/src/components/Sidebar.jsx`

- [ ] **Step 1: Add the "Plan" tab to SETTINGS_TABS**

In `app/client/src/components/Sidebar.jsx`, change `SETTINGS_TABS` (line 403) to append a plan tab:

```javascript
const SETTINGS_TABS = [
  { id: "user", label: "User" },
  { id: "github", label: "GitHub" },
  { id: "gitlab", label: "GitLab" },
  { id: "azuredevops", label: "Azure DevOps" },
  { id: "apitokens", label: "API Tokens" },
  { id: "envvars", label: "Env Vars" },
  { id: "resend", label: "Resend" },
  { id: "plan", label: "Plan" },
];
```

- [ ] **Step 2: Add the PlanTab component**

In `app/client/src/components/Sidebar.jsx`, directly ABOVE the `function ResendTab()`
definition (near line 1065), insert:

```jsx
function PlanTab() {
  const [planId, setPlanId] = useState("max5");
  const [plans, setPlans] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/usage-plan")
      .then((r) => r.json())
      .then((data) => {
        setPlanId(data.planId || "max5");
        setPlans(data.plans || []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function save(next) {
    setPlanId(next);
    setSaving(true);
    setSaved(false);
    try {
      await fetch("/api/usage-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: next }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <div className="text-sm text-muted-foreground py-4">Loading...</div>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Your Claude plan determines the token limit shown in the status bar for the
        current 5-hour usage window.
      </p>
      <div className="flex flex-col gap-2">
        {plans.map((p) => (
          <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              name="plan"
              value={p.id}
              checked={planId === p.id}
              onChange={() => save(p.id)}
            />
            <span className="font-medium">{p.label}</span>
            <span className="text-muted-foreground text-xs">
              {(p.limit / 1000).toFixed(0)}k tokens / 5h
            </span>
          </label>
        ))}
      </div>
      {saving && <span className="text-xs text-muted-foreground">Saving…</span>}
      {saved && <span className="text-xs text-green-500">Saved</span>}
    </div>
  );
}
```

- [ ] **Step 3: Render the tab**

In `app/client/src/components/Sidebar.jsx`, find the tab render block (near line 1283):

```jsx
          {activeTab === "resend" && <ResendTab />}
```
Add below it:
```jsx
          {activeTab === "plan" && <PlanTab />}
```

- [ ] **Step 4: Verify the client builds**

Run: `cd app && npm run build`
Expected: `built in ...` with no errors.

- [ ] **Step 5: Manual verification**

Start the app (`cd app && npm run dev:server` + `npm run dev:client`), open Settings →
Plan, select Max20, and confirm the status-bar bar's denominator updates to `220k`
on the next poll (or reload). Confirm the bar shows `used/limit` and a `resets in …`
countdown that ticks down, and shows `idle` when there has been no activity for 5h.

- [ ] **Step 6: Commit**

```bash
git add app/client/src/components/Sidebar.jsx
git commit -m "feat: add plan selector to settings"
```

---

## Self-Review Notes

- **Spec coverage:** window calc + 5h blocks + dedup + token basis + cache (Task 1);
  plan config + limits (Task 2); three API routes (Task 3); polling hook (Task 4);
  status-bar bar + countdown + idle (Task 5); App wiring (Task 6); plan selector
  settings UI (Task 7). All spec sections map to a task.
- **Placeholder scan:** none — every code step has complete code; commands have
  expected output.
- **Type consistency:** `readWindow()` returns `{ active, usedTokens, windowStart,
  resetAt }`; the `/api/usage/window` route spreads it and adds `planId`, `limit`;
  the hook stores that object as `window`; `App.jsx` passes it as `planWindow`;
  `StatusBar` reads `planWindow.{active,usedTokens,limit,planId,resetAt}`. Consistent.
  `computeWindow(entries, now)` / `countTokens(usage)` / `WINDOW_MS` names match
  between Task 1's implementation and tests. `normalizePlanId`/`PLAN_LIMITS`/`PLANS`
  match between Task 2 and Task 3.
