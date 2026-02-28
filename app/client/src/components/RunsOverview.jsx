import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, CheckCircle, XCircle, AlertCircle, Loader2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDuration, formatRelativeTime } from "@/lib/cron";
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

export default function RunsOverview({ onBack, onViewRun, fetchAllRuns }) {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadRuns = useCallback(async () => {
    try {
      const data = await fetchAllRuns(100);
      setRuns(data);
    } catch {
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [fetchAllRuns]);

  useEffect(() => {
    loadRuns();
    const interval = setInterval(loadRuns, 30000);
    return () => clearInterval(interval);
  }, [loadRuns]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card">
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-sm font-semibold">All Task Runs</h2>
        {runs.length > 0 && (
          <span className="text-xs text-muted-foreground">{runs.length} runs</span>
        )}
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading runs...
          </div>
        ) : runs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
            <div className="h-16 w-16 rounded-2xl bg-muted/30 border border-border/50 flex items-center justify-center mb-4">
              <Clock className="h-8 w-8 text-muted-foreground/30" />
            </div>
            <p className="text-sm font-medium text-foreground/60 mb-1">No runs yet</p>
            <p className="text-xs text-muted-foreground/60 max-w-xs">
              Task runs will appear here once you execute a task.
            </p>
          </div>
        ) : (
          <div className="p-4 space-y-1">
            {runs.map((run) => {
              const StatusIcon = STATUS_ICONS[run.status] || Clock;
              return (
                <button
                  key={`${run.taskId}-${run.id}`}
                  onClick={() => onViewRun && onViewRun(run.taskId, run.id)}
                  className="w-full text-left rounded-md border border-border/50 hover:border-border hover:bg-muted/30 transition-colors px-3 py-2 group"
                >
                  <div className="flex items-center gap-2">
                    <StatusIcon className={cn("h-3.5 w-3.5 shrink-0", STATUS_COLORS[run.status] || "text-muted-foreground")} />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium">{run.taskName}</span>
                      <span className="text-[11px] text-muted-foreground ml-2">
                        {new Date(run.startedAt).toLocaleString()}
                      </span>
                    </div>
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      {formatDuration(run.durationMs)}
                    </span>
                    {run.cost > 0 && (
                      <span className="text-[11px] text-muted-foreground shrink-0">
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
