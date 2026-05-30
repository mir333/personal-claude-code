// Assign simple layered (x,y) coordinates to graph nodes via BFS from start.
// Pure function; input is { nodes, edges } from the server buildGraph output.
export function layoutGraph(graph, startId) {
  const COL_W = 220, ROW_H = 90, PAD = 20;
  const adjacency = new Map();
  for (const n of graph.nodes) adjacency.set(n.id, []);
  for (const e of graph.edges) {
    if (adjacency.has(e.from)) adjacency.get(e.from).push(e.to);
  }
  const depth = new Map();
  const queue = [];
  const start = startId && adjacency.has(startId) ? startId : graph.nodes[0]?.id;
  if (start) { depth.set(start, 0); queue.push(start); }
  while (queue.length) {
    const id = queue.shift();
    const d = depth.get(id);
    for (const to of adjacency.get(id) || []) {
      if (!depth.has(to)) { depth.set(to, d + 1); queue.push(to); }
    }
  }
  // Nodes unreachable from start get appended at the end.
  let maxDepth = 0;
  for (const v of depth.values()) maxDepth = Math.max(maxDepth, v);
  const perLevel = new Map();
  const positioned = graph.nodes.map((n) => {
    const d = depth.has(n.id) ? depth.get(n.id) : maxDepth + 1;
    const row = perLevel.get(d) || 0;
    perLevel.set(d, row + 1);
    return { ...n, x: PAD + d * COL_W, y: PAD + row * ROW_H, col: d, row };
  });
  const width = PAD * 2 + (Math.max(maxDepth + 1, 1)) * COL_W;
  let maxRows = 0;
  for (const r of perLevel.values()) maxRows = Math.max(maxRows, r);
  const height = PAD * 2 + Math.max(maxRows, 1) * ROW_H;
  return { nodes: positioned, edges: graph.edges, width, height };
}
