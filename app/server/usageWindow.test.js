import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUsage } from "./usageWindow.js";

const SAMPLE = {
  five_hour: { utilization: 41.0, resets_at: "2026-06-06T09:00:00.853176+00:00" },
  seven_day: { utilization: 36.0, resets_at: "2026-06-06T10:00:00.000000+00:00" },
  extra_usage: { is_enabled: false },
};

test("parseUsage maps five_hour and seven_day utilization + resetAt", () => {
  const r = parseUsage(SAMPLE);
  assert.equal(r.fiveHour.utilization, 41.0);
  assert.equal(r.fiveHour.resetAt, Date.parse("2026-06-06T09:00:00.853176+00:00"));
  assert.equal(r.sevenDay.utilization, 36.0);
  assert.equal(r.sevenDay.resetAt, Date.parse("2026-06-06T10:00:00.000000+00:00"));
});

test("parseUsage returns null for missing windows", () => {
  const r = parseUsage({ five_hour: null });
  assert.equal(r.fiveHour, null);
  assert.equal(r.sevenDay, null);
});

test("parseUsage returns null when utilization is not a number", () => {
  const r = parseUsage({ five_hour: { utilization: null, resets_at: "x" } });
  assert.equal(r.fiveHour, null);
});

test("parseUsage tolerates a missing resets_at", () => {
  const r = parseUsage({ five_hour: { utilization: 12 } });
  assert.equal(r.fiveHour.utilization, 12);
  assert.equal(r.fiveHour.resetAt, null);
});

test("parseUsage tolerates an unparseable resets_at", () => {
  const r = parseUsage({ five_hour: { utilization: 5, resets_at: "not-a-date" } });
  assert.equal(r.fiveHour.utilization, 5);
  assert.equal(r.fiveHour.resetAt, null);
});

test("parseUsage handles empty input", () => {
  const r = parseUsage(undefined);
  assert.equal(r.fiveHour, null);
  assert.equal(r.sevenDay, null);
});
