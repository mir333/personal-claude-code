import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, Play, Pencil, Trash2, Loader2, CheckCircle, XCircle, Clock, AlertCircle, FolderOpen, Globe, Copy, CopyCheck, RefreshCw, FileText, X, Square, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Dialog } from "@/components/ui/dialog";
import Markdown from "./Markdown.jsx";
import { describeCron, formatDuration, formatRelativeTime } from "@/lib/cron";
import { getModelLabel } from "@/lib/models";
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

export default function TaskDetail({
  task,
  onBack,
  onEdit,
  onDelete,
  onToggle,
  onTrigger,
  onStop,
  onViewRun,
  fetchRuns,
  onGenerateWebhookToken,
  onRevokeWebhookToken,
}) {
  const [runs, setRuns] = useState([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState(null);
  const [webhookCopied, setWebhookCopied] = useState(false);
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [summaryDialog, setSummaryDialog] = useState({ open: false, content: null, loading: false, runDate: null });

  const loadRuns = useCallback(async () => {
    setRunsLoading(true);
    try {
      const data = await fetchRuns(task.id, 50);
      setRuns(data);
    } catch {
      setRuns([]);
    } finally {
      setRunsLoading(false);
    }
  }, [task.id, fetchRuns]);

  useEffect(() => {
    loadRuns();
    // Refresh every 30 seconds
    const interval = setInterval(loadRuns, 30000);
    return () => clearInterval(interval);
  }, [loadRuns]);

  async function handleTrigger() {
    setTriggering(true);
    try {
      await onTrigger(task.id);
      // Refresh runs after a delay to catch the result
      setTimeout(loadRuns, 2000);
    } catch (err) {
      alert(err.message || "Failed to run task");
    } finally {
      setTriggering(false);
    }
  }

  async function handleStop() {
    setStopping(true);
    try {
      await onStop(task.id);
    } catch (err) {
      alert(err.message || "Failed to stop task");
    } finally {
      setStopping(false);
    }
  }

  async function handleDelete() {
    if (confirm(`Delete task "${task.name}"? This will also delete all run history.`)) {
      await onDelete(task.id);
      onBack();
    }
  }

  async function handleGenerateToken() {
    setWebhookLoading(true);
    try {
      const data = await onGenerateWebhookToken(task.id);
      setWebhookUrl(data.webhookUrl);
    } catch (err) {
      alert(err.message || "Failed to generate webhook URL");
    } finally {
      setWebhookLoading(false);
    }
  }

  async function handleRevokeToken() {
    if (!confirm("Revoke webhook URL? Any integrations using it will stop working.")) return;
    setWebhookLoading(true);
    try {
      await onRevokeWebhookToken(task.id);
      setWebhookUrl(null);
    } catch (err) {
      alert(err.message || "Failed to revoke webhook");
    } finally {
      setWebhookLoading(false);
    }
  }

  function handleCopyWebhookUrl() {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl);
    setWebhookCopied(true);
    setTimeout(() => setWebhookCopied(false), 1500);
  }

  function handleOpenSummary(e, run) {
    e.stopPropagation();
    setSummaryDialog({ open: true, content: null, loading: true, runDate: new Date(run.startedAt).toLocaleString() });
    fetch(`/api/tasks/${task.id}/runs/${run.id}/summary`)
      .then((r) => {
        if (!r.ok) throw new Error("Summary not found");
        return r.text();
      })
      .then((text) => setSummaryDialog((prev) => ({ ...prev, content: text, loading: false })))
      .catch(() => setSummaryDialog((prev) => ({ ...prev, content: "*Summary not available.*", loading: false })));
  }

  const isScheduled = !!task.cronExpression;
  const dirName = task.workingDirectory.split("/").pop();

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
              <h2 className="text-sm font-semibold truncate">{task.name}</h2>
              {isScheduled ? (
                <Badge variant={task.enabled ? "default" : "secondary"} className="text-[10px] py-0">
                  {task.enabled ? "Active" : "Paused"}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] py-0 text-blue-500 border-blue-500/50">
                  One-off
                </Badge>
              )}
              {task.running && (
                <Badge variant="outline" className="text-[10px] py-0 text-yellow-500 border-yellow-500/50">
                  <Loader2 className="h-2.5 w-2.5 animate-spin mr-1" />
                  Running
                </Badge>
              )}
            </div>
            {isScheduled && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                <span>{describeCron(task.cronExpression)}</span>
                <span className="font-mono text-[11px] text-muted-foreground/60">{task.cronExpression}</span>
              </div>
            )}
            {!isScheduled && (
              <div className="text-xs text-muted-foreground mt-0.5">Manual execution only</div>
            )}
          </div>
        </div>

        {/* Info row */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground pl-10">
          <span className="flex items-center gap-1">
            <FolderOpen className="h-3 w-3 text-muted-foreground/60" />
            <span className="font-medium text-foreground/80">{dirName}</span>
          </span>
          <span className="flex items-center gap-1">
            <Cpu className="h-3 w-3 text-muted-foreground/60" />
            <span className="font-medium text-foreground/80">{getModelLabel(task.model)}</span>
          </span>
          {task.lastRunAt && (
            <span>
              <span className="text-muted-foreground/60">Last run:</span>{" "}
              <span className={cn("font-medium", STATUS_COLORS[task.lastRunStatus] || "text-foreground/80")}>
                {formatRelativeTime(task.lastRunAt)}
              </span>
            </span>
          )}
          {isScheduled && task.nextRunAt && task.enabled && (
            <span>
              <span className="text-muted-foreground/60">Next:</span>{" "}
              <span className="font-medium text-foreground/80">{formatRelativeTime(task.nextRunAt)}</span>
            </span>
          )}
        </div>

        {/* Prompt preview */}
        <div className="pl-10">
          <p className="text-[11px] text-muted-foreground/60 mb-0.5">Prompt:</p>
          <pre className="text-xs text-foreground/80 bg-muted/50 rounded-md px-3 py-2 whitespace-pre-wrap max-h-24 overflow-y-auto border border-border/50">
            {task.prompt}
          </pre>
        </div>

        {/* Webhook section */}
        <div className="pl-10">
          <p className="text-[11px] text-muted-foreground/60 mb-1">Webhook:</p>
          {task.webhookToken ? (
            <div className="space-y-1.5">
              {webhookUrl ? (
                <div className="flex items-center gap-2">
                  <code className="text-[11px] bg-muted/50 rounded px-2 py-1 border border-border/50 truncate flex-1 select-all">
                    {webhookUrl}
                  </code>
                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={handleCopyWebhookUrl}>
                    {webhookCopied ? <CopyCheck className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Webhook enabled — <button className="underline hover:text-foreground" onClick={handleGenerateToken}>show URL</button>
                </p>
              )}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-6"
                  onClick={handleGenerateToken}
                  disabled={webhookLoading}
                >
                  <RefreshCw className={cn("h-3 w-3 mr-1", webhookLoading && "animate-spin")} />
                  Regenerate
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-6 text-destructive hover:text-destructive"
                  onClick={handleRevokeToken}
                  disabled={webhookLoading}
                >
                  Revoke
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-6"
              onClick={handleGenerateToken}
              disabled={webhookLoading}
            >
              {webhookLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Globe className="h-3 w-3 mr-1" />}
              Enable Webhook
            </Button>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 pl-10">
          {task.running ? (
            <Button
              variant="destructive"
              size="sm"
              className="text-xs h-7"
              onClick={handleStop}
              disabled={stopping}
            >
              {stopping ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Square className="h-3 w-3 mr-1 fill-current" />
              )}
              Stop
            </Button>
          ) : (
            <Button
              variant={isScheduled ? "outline" : "default"}
              size="sm"
              className="text-xs h-7"
              onClick={handleTrigger}
              disabled={triggering}
            >
              {triggering ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Play className="h-3 w-3 mr-1" />
              )}
              Run Now
            </Button>
          )}
          <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => onEdit(task)}>
            <Pencil className="h-3 w-3 mr-1" />
            Edit
          </Button>
          {isScheduled && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7"
              onClick={() => onToggle(task.id, !task.enabled)}
            >
              {task.enabled ? "Pause" : "Resume"}
            </Button>
          )}
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
            <p className="text-xs text-muted-foreground/60 mt-1">Click "Run Now" to execute this task</p>
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
                    {run.outputFiles?.length > 0 && (
                      <span
                        role="button"
                        onClick={(e) => handleOpenSummary(e, run)}
                        className="flex items-center gap-0.5 text-[11px] text-blue-500 hover:text-blue-400 hover:underline cursor-pointer"
                        title="View summary"
                      >
                        <FileText className="h-3 w-3" />
                        Summary
                      </span>
                    )}
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

      {/* Summary dialog */}
      <Dialog
        open={summaryDialog.open}
        onClose={() => setSummaryDialog({ open: false, content: null, loading: false, runDate: null })}
        className="max-w-[90vw] max-h-[95vh] w-[90vw]"
      >
        <div className="flex flex-col h-full max-h-[95vh]">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
            <div>
              <h3 className="text-sm font-semibold">{task.name} — Summary</h3>
              {summaryDialog.runDate && (
                <p className="text-xs text-muted-foreground mt-0.5">{summaryDialog.runDate}</p>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setSummaryDialog({ open: false, content: null, loading: false, runDate: null })}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {summaryDialog.loading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Loading summary...
              </div>
            ) : (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <Markdown>{summaryDialog.content}</Markdown>
              </div>
            )}
          </div>
        </div>
      </Dialog>
    </div>
  );
}
