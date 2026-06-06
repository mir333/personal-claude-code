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
