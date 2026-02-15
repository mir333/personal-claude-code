import { Activity, Coins, ArrowDownToLine, ArrowUpFromLine, Database } from "lucide-react";
import { Separator } from "@/components/ui/separator";

function formatTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function formatCost(usd) {
  if (usd < 0.01) return "$" + usd.toFixed(4);
  return "$" + usd.toFixed(2);
}

export default function StatusBar({ stats, connected }) {
  return (
    <div className="flex items-center gap-3 px-4 py-1.5 border-b border-border bg-card text-xs text-muted-foreground select-none">
      <span className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-green-500" : "bg-yellow-500 animate-pulse"}`} />
        {connected ? "Connected" : "Reconnecting"}
      </span>

      <Separator orientation="vertical" className="h-3" />

      <span className="flex items-center gap-1" title="Requests this session">
        <Activity className="h-3 w-3" />
        {stats.requests} {stats.requests === 1 ? "request" : "requests"}
      </span>

      <Separator orientation="vertical" className="h-3" />

      <span className="flex items-center gap-1" title="Input tokens">
        <ArrowDownToLine className="h-3 w-3" />
        {formatTokens(stats.inputTokens)} in
      </span>

      <span className="flex items-center gap-1" title="Output tokens">
        <ArrowUpFromLine className="h-3 w-3" />
        {formatTokens(stats.outputTokens)} out
      </span>

      {stats.cacheReadTokens > 0 && (
        <span className="flex items-center gap-1" title="Cache read tokens">
          <Database className="h-3 w-3" />
          {formatTokens(stats.cacheReadTokens)} cached
        </span>
      )}

      <Separator orientation="vertical" className="h-3" />

      <span className="flex items-center gap-1" title="Session cost">
        <Coins className="h-3 w-3" />
        {formatCost(stats.totalCost)}
      </span>
    </div>
  );
}
