import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, Play, Pencil, Trash2, Loader2, CheckCircle, XCircle, Clock, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { describeCron, formatDuration, formatRelativeTime } from "@/lib/cron";
import { cn } from "@/lib/utils";

const STATUS_ICONS = {
  success: CheckCircle,
  error: XCircle,
  interrupted: AlertCircle,
};

const STATUS_COLORS = {
  success: "text-green-500",
  error: "text-red-500",
  interrupted: "text-yellow-500",
};

export default function ScheduleDetail({
  schedule,
  onBack,
  onEdit,
  onDelete,
  onToggle,
  onTrigger,
  onViewRun,
  fetchRuns,
}) {
  const [runs, setRuns] = useState([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);

  const loadRuns = useCallback(async () => {
    setRunsLoading(true);
    try {
      const data = await fetchRuns(schedule.id, 50);
      setRuns(data);
    } catch {
      setRuns([]);
    } finally {
      setRunsLoading(false);
    }
  }, [schedule.id, fetchRuns]);

  useEffect(() => {
    loadRuns();
    // Refresh every 30 seconds
    const interval = setInterval(loadRuns, 30000);
    return () => clearInterval(interval);
  }, [loadRuns]);

  async function handleTrigger() {
    setTriggering(true);
    try {
      await onTrigger(schedule.id);
      // Refresh runs after a delay to catch the result
      setTimeout(loadRuns, 2000);
    } catch (err) {
      alert(err.message || "Failed to trigger schedule");
    } finally {
      setTriggering(false);
    }
  }

  async function handleDelete() {
    if (confirm(`Delete schedule "${schedule.name}"? This will also delete all run history.`)) {
      await onDelete(schedule.id);
      onBack();
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-card space-y-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold truncate">{schedule.name}</h2>
              <Badge variant={schedule.enabled ? "default" : "secondary"} className="text-[10px] py-0">
                {schedule.enabled ? "Active" : "Paused"}
              </Badge>
              {schedule.running && (
                <Badge variant="outline" className="text-[10px] py-0 text-yellow-500 border-yellow-500/50">
                  <Loader2 className="h-2.5 w-2.5 animate-spin mr-1" />
                  Running
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
              <span>{describeCron(schedule.cronExpression)}</span>
              <span className="font-mono text-[11px] text-muted-foreground/60">{schedule.cronExpression}</span>
            </div>
          </div>
        </div>

        {/* Info row */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground pl-10">
          <span>
            <span className="text-muted-foreground/60">Provider:</span>{" "}
            <span className="font-medium text-foreground/80">{schedule.provider}</span>
          </span>
          <span>
            <span className="text-muted-foreground/60">Repo:</span>{" "}
            <span className="font-medium text-foreground/80">{schedule.repoFullName}</span>
          </span>
          {schedule.lastRunAt && (
            <span>
              <span className="text-muted-foreground/60">Last run:</span>{" "}
              <span className={cn("font-medium", STATUS_COLORS[schedule.lastRunStatus] || "text-foreground/80")}>
                {formatRelativeTime(schedule.lastRunAt)}
              </span>
            </span>
          )}
          {schedule.nextRunAt && schedule.enabled && (
            <span>
              <span className="text-muted-foreground/60">Next:</span>{" "}
              <span className="font-medium text-foreground/80">{formatRelativeTime(schedule.nextRunAt)}</span>
            </span>
          )}
        </div>

        {/* Prompt preview */}
        <div className="pl-10">
          <p className="text-[11px] text-muted-foreground/60 mb-0.5">Prompt:</p>
          <pre className="text-xs text-foreground/80 bg-muted/50 rounded-md px-3 py-2 whitespace-pre-wrap max-h-24 overflow-y-auto border border-border/50">
            {schedule.prompt}
          </pre>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 pl-10">
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7"
            onClick={handleTrigger}
            disabled={triggering || schedule.running}
          >
            {triggering || schedule.running ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <Play className="h-3 w-3 mr-1" />
            )}
            Run Now
          </Button>
          <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => onEdit(schedule)}>
            <Pencil className="h-3 w-3 mr-1" />
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7"
            onClick={() => onToggle(schedule.id, !schedule.enabled)}
          >
            {schedule.enabled ? "Pause" : "Resume"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7 text-destructive hover:text-destructive"
            onClick={handleDelete}
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Delete
          </Button>
        </div>
      </div>

      <Separator />

      {/* Run history */}
      <div className="px-4 py-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Run History</h3>
      </div>

      <ScrollArea className="flex-1">
        {runsLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            <span className="text-sm">Loading runs...</span>
          </div>
        ) : runs.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-muted-foreground">
            <Clock className="h-8 w-8 text-muted-foreground/20 mb-2" />
            <p className="text-sm">No runs yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Click "Run Now" to trigger a manual run</p>
          </div>
        ) : (
          <div className="px-4 pb-4 space-y-1">
            {runs.map((run) => {
              const StatusIcon = STATUS_ICONS[run.status] || Clock;
              return (
                <button
                  key={run.id}
                  onClick={() => onViewRun(run.id)}
                  className="w-full text-left rounded-md border border-border/50 hover:border-border hover:bg-muted/30 transition-colors px-3 py-2 group"
                >
                  <div className="flex items-center gap-2">
                    <StatusIcon className={cn("h-3.5 w-3.5 shrink-0", STATUS_COLORS[run.status] || "text-muted-foreground")} />
                    <span className="text-xs font-medium flex-1 truncate">
                      {new Date(run.startedAt).toLocaleString()}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {formatDuration(run.durationMs)}
                    </span>
                    {run.cost > 0 && (
                      <span className="text-[11px] text-muted-foreground">
                        ${run.cost < 0.01 ? run.cost.toFixed(4) : run.cost.toFixed(2)}
                      </span>
                    )}
                  </div>
                  {run.resultSummary && (
                    <p className="text-[11px] text-muted-foreground/70 truncate mt-0.5 pl-5.5">
                      {run.resultSummary.slice(0, 150)}
                    </p>
                  )}
                  {run.error && (
                    <p className="text-[11px] text-destructive/80 truncate mt-0.5 pl-5.5">
                      {run.error}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
