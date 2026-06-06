# Plan-Window Usage in the Status Bar — Design

## Overview

Add a status-bar segment that shows the current **5-hour rolling Claude plan
window** usage against the selected plan quota, plus a countdown to when the
window resets. Inspired by [Claude-Code-Usage-Monitor], but implemented natively
by reading Claude Code's local JSONL transcripts.

## Goals

- Show `used / limit` tokens for the active 5-hour window with a colored bar.
- Show a live "resets in HH:MM" countdown.
- Let the user pick their plan (Pro / Max5 / Max20) in settings.
- Accurate: reflect ALL Claude Code usage on the machine (web agents + CLI
  terminals share `~/.claude`), not just usage routed through this app.

## Non-Goals (v1)

- Burn rate, depletion prediction, cost-vs-cost-cap (deferred).
- P90 auto-detected limits (fixed plan selector only).
- Historical charts / multi-window views.

## What the user sees

A new segment in `StatusBar`, always visible (including mobile):

- Progress bar + `Plan 45k / 88k`, colored: green `<70%`, yellow `>=70%`,
  red `>=90%` (same thresholds/util as the existing context gauge).
- `resets in 2h13m`, ticking down each second client-side.
- If no activity in the last 5h: show `0 / 88k · idle` (no reset countdown).

## Data source & 5-hour window calculator

New server module `app/server/usageWindow.js`.

Algorithm (mirrors ccusage "blocks" / the monitor):

1. Enumerate `~/.claude/projects/**/*.jsonl`, filtered to files whose **mtime is
   within the last 6 hours** (perf: skips the bulk of ~600 historical files).
2. Parse each line; keep entries that have `message.usage` and a `timestamp`.
   Extract `{ ts, id: message.id, usage }`.
3. **Dedup by `message.id`** (a message can appear in multiple files / lines;
   counting once avoids inflating cache-read totals).
4. Sort entries by `ts`. Group into **5-hour blocks**: the first entry starts a
   block at `floor(ts to the hour)`; subsequent entries join the block while
   `ts < blockStart + 5h` AND the gap from the previous entry is `<= 5h`;
   otherwise they start a new block.
5. The **active block** is the one where `now < blockStart + 5h` and it contains
   the most recent entry. If the most recent entry is older than 5h, there is no
   active block (idle).
6. Token count per entry (the counted measure):
   `input_tokens + output_tokens + cache_creation_input_tokens`
   (**cache_read excluded** — cheap and huge; including it would blow past the
   plan's calibrated limits). Sum across the active block.

Return shape:

```js
{
  active: boolean,         // false when idle (no activity in last 5h)
  usedTokens: number,      // 0 when idle
  windowStart: number|null,// epoch ms (block start), null when idle
  resetAt: number|null,    // windowStart + 5h, null when idle
}
```

Caching: compute at most once per **30 seconds** (module-level cache keyed by a
timestamp); concurrent requests within the window reuse the cached result.

## Plan limit setting

New server module `app/server/usagePlan.js`, mirroring `resendConfig.js`:

- Per-profile file `usage-plan.json`: `{ planId: "pro" | "max5" | "max20" }`.
- `loadUsagePlan(profileId)` → `{ planId }`, default `"max5"`.
- `saveUsagePlan(profileId, { planId })` (validates against known plans).
- Plan→limit map (server-side constant):
  `{ pro: 19000, max5: 88000, max20: 220000 }`.

## API

- `GET /api/usage/window` → merges the active window with the profile's plan:

  ```js
  { active, usedTokens, limit, planId, windowStart, resetAt }
  ```

  Cached ~30s via the module cache.

- `GET /api/usage-plan` → `{ planId, limit, plans: [{id,label,limit}] }`.
- `POST /api/usage-plan` `{ planId }` → persists, returns the same shape.

Both authenticated routes, scoped to `req.profile?.id` like existing usage/config
routes.

## Client

- New hook `app/client/src/hooks/useUsageWindow.js`: polls `/api/usage/window`
  every 60s (same cadence as `useUsageStats`); returns `{ window, refresh }`.
- `App.jsx`: call the hook, pass `window` into `StatusBar`.
- `StatusBar.jsx`: new segment after the context gauge / before session stats.
  - Progress bar reusing `formatTokens` + a `windowColor(pct)` helper (same
    thresholds as `contextColor`).
  - Countdown computed from `resetAt` using a 1-second `setInterval` (local
    `useEffect` state inside StatusBar or a tiny child component), formatted
    `Hh MMm` / `MMm`.
- Settings UI: a plan `<select>` (Pro / Max5 / Max20) added to the existing
  settings area in `Sidebar.jsx` next to the Resend config, backed by a small
  fetch to `/api/usage-plan`.

## Testing

`node --test` unit tests for `usageWindow.js`'s pure block logic. Refactor the
core into a pure function `computeWindow(entries, now)` that takes already-parsed
`{ ts, id, usage }` entries (no filesystem), so tests can feed synthetic entries:

- single block under limit → correct sum, resetAt = start+5h
- entries spanning >5h → only the active block counts
- a >5h gap → new block starts; older usage excluded
- duplicate `message.id` counted once
- idle (latest entry >5h old) → `active: false`, `usedTokens: 0`
- cache_read excluded from the sum

The filesystem scan (`readWindow()`) wraps `computeWindow` and is verified
manually against the live `~/.claude/projects` data.

## Files

Server:
- `app/server/usageWindow.js` (new) — scan + `computeWindow` + cache.
- `app/server/usageWindow.test.js` (new) — pure-logic tests.
- `app/server/usagePlan.js` (new) — per-profile plan config.
- `app/server/index.js` (modify) — three routes.

Client:
- `app/client/src/hooks/useUsageWindow.js` (new).
- `app/client/src/components/StatusBar.jsx` (modify) — new segment + countdown.
- `app/client/src/App.jsx` (modify) — wire the hook into StatusBar.
- `app/client/src/components/Sidebar.jsx` (modify) — plan selector.

## Confirmed defaults

- Token basis: `input + output + cache_creation` (excludes cache_read).
- Window: start floored to the hour, reset = start + 5h.
- Plan limits: Pro 19k / Max5 88k / Max20 220k (configurable constant), default
  Max5.

[Claude-Code-Usage-Monitor]: https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor
