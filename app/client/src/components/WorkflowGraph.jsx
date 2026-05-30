import { layoutGraph } from "@/lib/workflowGraph";

const TYPE_COLORS = {
  task: "#2563eb",
  decision: "#d97706",
  fork: "#7c3aed",
  join: "#7c3aed",
  unknown: "#6b7280",
};
const STATUS_COLORS = {
  pending: "#9ca3af",
  running: "#2563eb",
  success: "#16a34a",
  error: "#dc2626",
  skipped: "#d1d5db",
};

export default function WorkflowGraph({ graph, startId, nodeState }) {
  if (!graph || !graph.nodes?.length) {
    return <p className="text-xs text-muted-foreground">No nodes to display.</p>;
  }
  const laid = layoutGraph(graph, startId);
  const NW = 160, NH = 48;
  const byId = Object.fromEntries(laid.nodes.map((n) => [n.id, n]));

  return (
    <svg width={laid.width} height={laid.height} className="max-w-full">
      {laid.edges.map((e, i) => {
        const a = byId[e.from], b = byId[e.to];
        if (!a || !b) return null;
        const x1 = a.x + NW, y1 = a.y + NH / 2;
        const x2 = b.x, y2 = b.y + NH / 2;
        return (
          <g key={i}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#9ca3af" strokeWidth="1.5"
              strokeDasharray={e.kind === "join-hint" ? "4 3" : undefined} />
            {e.label ? (
              <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 4} fontSize="10" fill="#6b7280" textAnchor="middle">
                {e.label.length > 22 ? e.label.slice(0, 22) + "…" : e.label}
              </text>
            ) : null}
          </g>
        );
      })}
      {laid.nodes.map((n) => {
        const st = nodeState?.[n.id]?.status;
        const border = st ? STATUS_COLORS[st] : (n.errors?.length ? "#dc2626" : TYPE_COLORS[n.type]);
        return (
          <g key={n.id}>
            <rect x={n.x} y={n.y} width={NW} height={NH} rx="6"
              fill="white" stroke={border} strokeWidth={n.errors?.length ? 2.5 : 1.5} />
            <text x={n.x + 8} y={n.y + 18} fontSize="11" fontWeight="600" fill="#111827">
              {n.label.length > 20 ? n.label.slice(0, 20) + "…" : n.label}
            </text>
            <text x={n.x + 8} y={n.y + 34} fontSize="9" fill={TYPE_COLORS[n.type]}>
              {n.type}{n.isStart ? " · start" : ""}{st ? ` · ${st}` : ""}
            </text>
            {n.errors?.length ? <title>{n.errors.join("\n")}</title> : null}
          </g>
        );
      })}
    </svg>
  );
}
