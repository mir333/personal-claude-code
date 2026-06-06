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
