// Client mirror of the server's buildGraph (without error attachment), used to
// render a workflow run graph from the stored DSL. Runs are already validated.
export function buildGraphFromDsl(dsl) {
  const nodes = [], edges = [];
  const raw = dsl?.nodes || {};
  for (const [id, node] of Object.entries(raw)) {
    nodes.push({ id, type: node?.type || "unknown", taskId: node?.taskId || null, label: id, isStart: dsl?.start === id, errors: [] });
    if (!node) continue;
    if (node.type === "task" || node.type === "join") {
      if (node.next) edges.push({ from: id, to: node.next, label: "" });
    } else if (node.type === "decision" && Array.isArray(node.edges)) {
      node.edges.forEach((e) => e?.next && edges.push({ from: id, to: e.next, label: e.condition || "" }));
    } else if (node.type === "fork" && Array.isArray(node.branches)) {
      node.branches.forEach((b) => edges.push({ from: id, to: b, label: "", kind: "fork" }));
      if (node.join) edges.push({ from: id, to: node.join, label: "join", kind: "join-hint" });
    }
  }
  return { nodes, edges, globalErrors: [] };
}
