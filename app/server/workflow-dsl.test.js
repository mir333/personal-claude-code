import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWorkflowSource, validateWorkflow, buildGraph } from "./workflow-dsl.js";

const TASK_IDS = ["t-scan", "t-fix", "t-notify", "t-issue"];

function validDsl() {
  return {
    name: "Sweep",
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

test("parseWorkflowSource parses JSON", () => {
  const { dsl, error } = parseWorkflowSource(JSON.stringify(validDsl()));
  assert.equal(error, null);
  assert.equal(dsl.start, "scan");
});

test("parseWorkflowSource reports JSON errors", () => {
  const { dsl, error } = parseWorkflowSource("{ not json");
  assert.equal(dsl, null);
  assert.ok(error);
});

test("validateWorkflow accepts a valid workflow", () => {
  const { valid, errors } = validateWorkflow(validDsl(), TASK_IDS);
  assert.equal(valid, true, JSON.stringify(errors));
  assert.equal(errors.length, 0);
});

test("validateWorkflow flags missing start", () => {
  const dsl = validDsl();
  delete dsl.start;
  const { valid, errors } = validateWorkflow(dsl, TASK_IDS);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => /start/i.test(e.message)));
});

test("validateWorkflow flags unknown taskId", () => {
  const dsl = validDsl();
  dsl.nodes.scan.taskId = "t-missing";
  const { valid, errors } = validateWorkflow(dsl, TASK_IDS);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.nodeId === "scan" && /task/i.test(e.message)));
});

test("validateWorkflow flags dangling next target", () => {
  const dsl = validDsl();
  dsl.nodes.scan.next = "nowhere";
  const { valid, errors } = validateWorkflow(dsl, TASK_IDS);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.nodeId === "scan" && /nowhere/.test(e.message)));
});

test("validateWorkflow flags decision edge without condition", () => {
  const dsl = validDsl();
  dsl.nodes.route.edges[0].condition = "";
  const { valid, errors } = validateWorkflow(dsl, TASK_IDS);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.nodeId === "route"));
});

test("validateWorkflow flags fork with <2 branches", () => {
  const dsl = validDsl();
  dsl.nodes.fork1.branches = ["fix"];
  const { valid, errors } = validateWorkflow(dsl, TASK_IDS);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.nodeId === "fork1"));
});

test("validateWorkflow flags fork with missing join", () => {
  const dsl = validDsl();
  dsl.nodes.fork1.join = "ghost";
  const { valid, errors } = validateWorkflow(dsl, TASK_IDS);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.nodeId === "fork1" && /join/i.test(e.message)));
});

test("buildGraph returns nodes and edges with errors attached", () => {
  const dsl = validDsl();
  dsl.nodes.scan.taskId = "t-missing";
  const { valid, errors } = validateWorkflow(dsl, TASK_IDS);
  const graph = buildGraph(dsl, errors);
  const scan = graph.nodes.find((n) => n.id === "scan");
  assert.equal(scan.type, "task");
  assert.ok(scan.errors.length > 0);
  assert.ok(graph.edges.some((e) => e.from === "route" && e.label));
  assert.equal(valid, false);
});
