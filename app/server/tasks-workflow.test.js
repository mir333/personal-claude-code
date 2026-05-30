import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTaskKind } from "./tasks.js";

test("normalizeTaskKind defaults to 'task'", () => {
  const t = normalizeTaskKind({ name: "x" });
  assert.equal(t.kind, "task");
  assert.equal(t.workflowSource, null);
});

test("normalizeTaskKind preserves workflow kind and source", () => {
  const t = normalizeTaskKind({ name: "x", kind: "workflow", workflowSource: "{}" });
  assert.equal(t.kind, "workflow");
  assert.equal(t.workflowSource, "{}");
});

test("normalizeTaskKind coerces unknown kind to 'task'", () => {
  const t = normalizeTaskKind({ name: "x", kind: "bogus" });
  assert.equal(t.kind, "task");
});
