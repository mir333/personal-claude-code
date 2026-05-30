import { test } from "node:test";
import assert from "node:assert/strict";
import { walkWorkflow } from "./workflow-engine.js";

function dsl() {
  return {
    name: "T",
    start: "scan",
    nodes: {
      scan: { type: "task", taskId: "t-scan", next: "route" },
      route: {
        type: "decision",
        prompt: "pick",
        edges: [
          { condition: "found", next: "fork1" },
          { condition: "clean", next: "notify" },
        ],
      },
      fork1: { type: "fork", branches: ["fix", "issue"], join: "merged" },
      fix: { type: "task", taskId: "t-fix", next: "merged" },
      issue: { type: "task", taskId: "t-issue", next: "merged" },
      merged: { type: "join", next: "notify" },
      notify: { type: "task", taskId: "t-notify", next: null },
    },
  };
}

function fakeDeps(opts = {}) {
  const ran = [];
  return {
    ran,
    runTask: async (taskId, payload) => {
      ran.push(taskId);
      return { outputText: `out:${taskId}`, error: opts.failTask === taskId ? "boom" : null };
    },
    decide: async (prompt, incoming, edges) => {
      const want = opts.choose || edges[0].condition;
      const idx = edges.findIndex((e) => e.condition === want);
      return idx >= 0 ? idx : 0;
    },
  };
}

test("walk runs task -> decision(clean) -> notify", async () => {
  const deps = fakeDeps({ choose: "clean" });
  const res = await walkWorkflow(dsl(), "init", deps);
  assert.equal(res.status, "success");
  assert.deepEqual(deps.ran, ["t-scan", "t-notify"]);
  assert.equal(res.state.scan.status, "success");
  assert.equal(res.state.route.chosenEdge, 1);
});

test("walk runs fork branches then join then notify", async () => {
  const deps = fakeDeps({ choose: "found" });
  const res = await walkWorkflow(dsl(), "init", deps);
  assert.equal(res.status, "success");
  assert.equal(deps.ran[0], "t-scan");
  assert.equal(deps.ran[deps.ran.length - 1], "t-notify");
  assert.ok(deps.ran.includes("t-fix"));
  assert.ok(deps.ran.includes("t-issue"));
  assert.equal(res.state.merged.status, "success");
});

test("walk fails the run when a task errors", async () => {
  const deps = fakeDeps({ choose: "found", failTask: "t-fix" });
  const res = await walkWorkflow(dsl(), "init", deps);
  assert.equal(res.status, "error");
  assert.ok(res.error);
});

test("walk enforces max-step cap on cycles", async () => {
  const looping = {
    name: "L",
    start: "a",
    nodes: {
      a: { type: "task", taskId: "t", next: "a" },
    },
  };
  const deps = fakeDeps();
  const res = await walkWorkflow(looping, "init", deps, { maxSteps: 5 });
  assert.equal(res.status, "error");
  assert.ok(/max/i.test(res.error));
});
