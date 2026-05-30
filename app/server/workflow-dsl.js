// Pure workflow DSL helpers: parse JSON source, validate the graph, and
// normalize it into nodes/edges for rendering. No I/O, no side effects.

export const NODE_TYPES = ["task", "decision", "fork", "join"];

/** Parse the raw DSL text (JSON). Returns { dsl, error }. */
export function parseWorkflowSource(text) {
  if (typeof text !== "string" || !text.trim()) {
    return { dsl: null, error: "Workflow definition is empty" };
  }
  try {
    const dsl = JSON.parse(text);
    if (!dsl || typeof dsl !== "object" || Array.isArray(dsl)) {
      return { dsl: null, error: "Workflow must be a JSON object" };
    }
    return { dsl, error: null };
  } catch (err) {
    return { dsl: null, error: `Invalid JSON: ${err.message}` };
  }
}

function err(nodeId, message) {
  return { nodeId: nodeId || null, message };
}

/**
 * Validate a parsed DSL object against the set of available task ids.
 * Returns { valid, errors: [{ nodeId, message }] }.
 */
export function validateWorkflow(dsl, availableTaskIds = []) {
  const errors = [];
  const taskIdSet = new Set(availableTaskIds);

  if (!dsl || typeof dsl !== "object") {
    return { valid: false, errors: [err(null, "Workflow must be an object")] };
  }

  const nodes = dsl.nodes && typeof dsl.nodes === "object" ? dsl.nodes : null;
  if (!nodes) {
    return { valid: false, errors: [err(null, "Workflow must have a 'nodes' object")] };
  }
  const ids = Object.keys(nodes);
  const idSet = new Set(ids);

  if (!dsl.start) {
    errors.push(err(null, "Workflow must define a 'start' node id"));
  } else if (!idSet.has(dsl.start)) {
    errors.push(err(null, `start refers to unknown node "${dsl.start}"`));
  }

  const targetExists = (nodeId, target, label) => {
    if (target === null || target === undefined) return; // end of chain
    if (!idSet.has(target)) {
      errors.push(err(nodeId, `${label} points to unknown node "${target}"`));
    }
  };

  for (const id of ids) {
    const node = nodes[id];
    if (!node || typeof node !== "object") {
      errors.push(err(id, "Node must be an object"));
      continue;
    }
    if (!NODE_TYPES.includes(node.type)) {
      errors.push(err(id, `Unknown node type "${node.type}"`));
      continue;
    }

    if (node.type === "task") {
      if (!node.taskId) {
        errors.push(err(id, "task node requires a taskId"));
      } else if (!taskIdSet.has(node.taskId)) {
        errors.push(err(id, `task "${node.taskId}" does not exist`));
      }
      targetExists(id, node.next, "next");
    } else if (node.type === "decision") {
      if (!Array.isArray(node.edges) || node.edges.length === 0) {
        errors.push(err(id, "decision node requires at least one edge"));
      } else {
        node.edges.forEach((e, i) => {
          if (!e || typeof e !== "object") {
            errors.push(err(id, `edge ${i} must be an object`));
            return;
          }
          if (!e.condition || !String(e.condition).trim()) {
            errors.push(err(id, `edge ${i} requires a non-empty condition`));
          }
          targetExists(id, e.next, `edge ${i} next`);
        });
      }
    } else if (node.type === "fork") {
      if (!Array.isArray(node.branches) || node.branches.length < 2) {
        errors.push(err(id, "fork node requires at least 2 branches"));
      } else {
        node.branches.forEach((b) => targetExists(id, b, "branch"));
      }
      if (!node.join) {
        errors.push(err(id, "fork node requires a join"));
      } else if (!idSet.has(node.join)) {
        errors.push(err(id, `fork join points to unknown node "${node.join}"`));
      } else if (nodes[node.join].type !== "join") {
        errors.push(err(id, `fork join "${node.join}" is not a join node`));
      }
    } else if (node.type === "join") {
      targetExists(id, node.next, "next");
    }
  }

  // No nesting: a referenced task must not itself be a workflow. The caller
  // passes only non-workflow task ids in availableTaskIds, so unknown-task
  // errors above already cover this.

  return { valid: errors.length === 0, errors };
}

/**
 * Normalize a DSL into { nodes: [...], edges: [...] } for rendering.
 * Attaches per-node errors (from validateWorkflow output) to each node.
 */
export function buildGraph(dsl, errors = []) {
  const byNode = new Map();
  for (const e of errors) {
    if (!e.nodeId) continue;
    if (!byNode.has(e.nodeId)) byNode.set(e.nodeId, []);
    byNode.get(e.nodeId).push(e.message);
  }
  const globalErrors = errors.filter((e) => !e.nodeId).map((e) => e.message);

  const nodes = [];
  const edges = [];
  const rawNodes = dsl && dsl.nodes && typeof dsl.nodes === "object" ? dsl.nodes : {};

  for (const [id, node] of Object.entries(rawNodes)) {
    nodes.push({
      id,
      type: node?.type || "unknown",
      taskId: node?.taskId || null,
      label: id,
      isStart: dsl?.start === id,
      errors: byNode.get(id) || [],
    });
    if (!node || typeof node !== "object") continue;
    if (node.type === "task" || node.type === "join") {
      if (node.next) edges.push({ from: id, to: node.next, label: "" });
    } else if (node.type === "decision" && Array.isArray(node.edges)) {
      node.edges.forEach((e) => {
        if (e && e.next) edges.push({ from: id, to: e.next, label: e.condition || "" });
      });
    } else if (node.type === "fork" && Array.isArray(node.branches)) {
      node.branches.forEach((b) => edges.push({ from: id, to: b, label: "", kind: "fork" }));
      if (node.join) edges.push({ from: id, to: node.join, label: "join", kind: "join-hint" });
    }
  }

  return { nodes, edges, globalErrors };
}
