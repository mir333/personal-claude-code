import { Activity, Coins, ArrowDownToLine, ArrowUpFromLine, Database, CalendarDays, Gauge } from "lucide-react";
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

function shortModel(name) {
  return name.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

function contextColor(pct) {
  if (pct >= 90) return "bg-red-500";
  if (pct >= 70) return "bg-yellow-500";
  return "bg-green-500";
}

function ModelCosts({ modelCosts, prefix }) {
  const entries = Object.entries(modelCosts || {});
  if (entries.length === 0) return null;
  return entries.map(([model, mu]) => (
    <span
      key={model}
      className="inline-flex items-center gap-1 shrink-0 rounded bg-muted/60 border border-border/50 px-1.5 py-0.5"
      title={`${prefix} ${model}: ${formatCost(mu.cost)} (${formatTokens(mu.inputTokens)} in, ${formatTokens(mu.outputTokens)} out)`}
    >
      <span className="font-medium text-foreground/70">{shortModel(model)}</span>
      <span>{formatCost(mu.cost)}</span>
      <span className="text-muted-foreground/60">{formatTokens(mu.inputTokens)}/{formatTokens(mu.outputTokens)}</span>
    </span>
  ));
}

export default function StatusBar({ usage, connected, contextInfo }) {
  const { session, weekly } = usage;
  const pct = contextInfo ? Math.min(100, (contextInfo.used / contextInfo.contextWindow) * 100) : 0;

  return (
    <div className="flex items-center gap-3 px-4 py-1.5 border-b border-border bg-card text-xs text-muted-foreground select-none overflow-x-auto">
      <span className="flex items-center gap-1.5 shrink-0">
        <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-green-500" : "bg-yellow-500 animate-pulse"}`} />
        {connected ? "Connected" : "Reconnecting"}
      </span>

      {contextInfo && (
        <>
          <Separator orientation="vertical" className="h-3 shrink-0" />

          <span
            className="flex items-center gap-1.5 shrink-0"
            title={`Context: ${formatTokens(contextInfo.used)} / ${formatTokens(contextInfo.contextWindow)} tokens (${pct.toFixed(0)}%)`}
          >
            <Gauge className="h-3 w-3" />
            <span className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
              <span
                className={`block h-full rounded-full transition-all ${contextColor(pct)}`}
                style={{ width: `${pct}%` }}
              />
            </span>
            <span>{formatTokens(contextInfo.used)}/{formatTokens(contextInfo.contextWindow)}</span>
          </span>
        </>
      )}

      <Separator orientation="vertical" className="h-3 shrink-0" />

      <span className="font-medium text-foreground/70 shrink-0">Session</span>

      <span className="flex items-center gap-1 shrink-0" title="Requests this session">
        <Activity className="h-3 w-3" />
        {session.requests}
      </span>

      <span className="flex items-center gap-1 shrink-0" title="Session input tokens">
        <ArrowDownToLine className="h-3 w-3" />
        {formatTokens(session.inputTokens)} in
      </span>

      <span className="flex items-center gap-1 shrink-0" title="Session output tokens">
        <ArrowUpFromLine className="h-3 w-3" />
        {formatTokens(session.outputTokens)} out
      </span>

      {session.cacheReadTokens > 0 && (
        <span className="flex items-center gap-1 shrink-0" title="Session cache read tokens">
          <Database className="h-3 w-3" />
          {formatTokens(session.cacheReadTokens)} cached
        </span>
      )}

      <span className="flex items-center gap-1 shrink-0" title="Session cost">
        <Coins className="h-3 w-3" />
        {formatCost(session.totalCost)}
      </span>

      <ModelCosts modelCosts={session.modelCosts} prefix="Session" />

      <Separator orientation="vertical" className="h-3 shrink-0" />

      <span className="font-medium text-foreground/70 flex items-center gap-1 shrink-0">
        <CalendarDays className="h-3 w-3" />
        Week
      </span>

      <span className="flex items-center gap-1 shrink-0" title="Weekly requests (all models)">
        <Activity className="h-3 w-3" />
        {weekly.requests}
      </span>

      <span className="flex items-center gap-1 shrink-0" title="Weekly input tokens (all models)">
        <ArrowDownToLine className="h-3 w-3" />
        {formatTokens(weekly.inputTokens)} in
      </span>

      <span className="flex items-center gap-1 shrink-0" title="Weekly output tokens (all models)">
        <ArrowUpFromLine className="h-3 w-3" />
        {formatTokens(weekly.outputTokens)} out
      </span>

      <span className="flex items-center gap-1 shrink-0" title="Weekly cost (all models)">
        <Coins className="h-3 w-3" />
        {formatCost(weekly.totalCost)}
      </span>

      <ModelCosts modelCosts={weekly.modelCosts} prefix="Weekly" />
    </div>
  );
}
