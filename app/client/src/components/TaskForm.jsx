import { useState, useEffect } from "react";
import { Loader2, ListTodo, FolderOpen, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { CRON_PRESETS, describeCron } from "@/lib/cron";
import { cn } from "@/lib/utils";

export default function TaskForm({ open, onClose, onSubmit, initial }) {
  const [name, setName] = useState(initial?.name || "");
  const [workingDirectory, setWorkingDirectory] = useState(initial?.workingDirectory || "");
  const [cronExpression, setCronExpression] = useState(initial?.cronExpression || "");
  const [prompt, setPrompt] = useState(initial?.prompt || "");
  const [workspaces, setWorkspaces] = useState([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(false);
  const [workspaceFilter, setWorkspaceFilter] = useState("");
  const [cronPreview, setCronPreview] = useState(null);
  const [cronError, setCronError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isEdit = !!initial;

  // Reset form when opened
  useEffect(() => {
    if (open) {
      setName(initial?.name || "");
      setWorkingDirectory(initial?.workingDirectory || "");
      setCronExpression(initial?.cronExpression || "");
      setPrompt(initial?.prompt || "");
      setError("");
      setCronError("");
      setWorkspaceFilter("");
    }
  }, [open, initial]);

  // Load workspace directories
  useEffect(() => {
    if (!open) return;
    setWorkspacesLoading(true);
    setWorkspaces([]);
    fetch("/api/workspace")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load workspaces");
        return r.json();
      })
      .then((data) => setWorkspaces(data))
      .catch(() => setWorkspaces([]))
      .finally(() => setWorkspacesLoading(false));
  }, [open]);

  // Validate cron expression (only if provided)
  useEffect(() => {
    if (!cronExpression.trim()) {
      setCronPreview(null);
      setCronError("");
      return;
    }
    const timer = setTimeout(() => {
      fetch("/api/tasks/validate-cron", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cronExpression }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.valid) {
            setCronPreview(data.nextRuns);
            setCronError("");
          } else {
            setCronPreview(null);
            setCronError(data.error || "Invalid expression");
          }
        })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [cronExpression]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        workingDirectory,
        cronExpression: cronExpression.trim() || null,
        prompt: prompt.trim(),
      });
      onClose();
    } catch (err) {
      setError(err.message || "Failed to save task");
    } finally {
      setSubmitting(false);
    }
  }

  const filteredWorkspaces = workspaces.filter((ws) =>
    ws.name.toLowerCase().includes(workspaceFilter.toLowerCase())
  );

  const selectedWorkspaceName = workspaces.find((ws) => ws.path === workingDirectory)?.name;

  const inputClass = "w-full px-3 py-2 text-sm rounded-md border border-input bg-background";

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <ListTodo className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">{isEdit ? "Edit Task" : "New Task"}</h2>
        </div>

        {error && (
          <div className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</div>
        )}

        {/* Name */}
        <div>
          <label className="text-xs text-muted-foreground font-medium">Name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Run Tests, Code Review, Daily Report"
            className="mt-1"
            required
          />
        </div>

        {/* Workspace Directory */}
        <div>
          <label className="text-xs text-muted-foreground font-medium">Workspace Directory</label>
          {workspacesLoading ? (
            <div className="flex items-center gap-2 mt-1 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading workspaces...
            </div>
          ) : workspaces.length === 0 ? (
            <div className="mt-1 text-xs text-muted-foreground py-2">
              No workspace directories found. Create a project first.
            </div>
          ) : (
            <>
              {workspaces.length > 5 && (
                <div className="relative mt-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <Input
                    placeholder="Filter workspaces..."
                    value={workspaceFilter}
                    onChange={(e) => setWorkspaceFilter(e.target.value)}
                    className="pl-8 h-8 text-xs"
                  />
                </div>
              )}
              <div className={cn("mt-1 max-h-36 overflow-y-auto rounded-md border border-input", workspaces.length <= 5 && "mt-1")}>
                {filteredWorkspaces.map((ws) => (
                  <button
                    key={ws.path}
                    type="button"
                    onClick={() => setWorkingDirectory(ws.path)}
                    className={cn(
                      "w-full text-left px-3 py-1.5 text-xs transition-colors",
                      "hover:bg-accent",
                      workingDirectory === ws.path && "bg-accent font-medium text-primary"
                    )}
                  >
                    <span className="truncate block flex items-center gap-1.5">
                      <FolderOpen className="h-3 w-3 shrink-0 text-muted-foreground" />
                      {ws.name}
                    </span>
                  </button>
                ))}
                {filteredWorkspaces.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-3">No matching workspaces</p>
                )}
              </div>
              {selectedWorkspaceName && (
                <p className="text-xs text-primary mt-1 flex items-center gap-1">
                  <FolderOpen className="h-3 w-3" />
                  {selectedWorkspaceName}
                </p>
              )}
            </>
          )}
        </div>

        {/* Cron Expression (optional) */}
        <div>
          <label className="text-xs text-muted-foreground font-medium">Schedule (Optional)</label>
          <Input
            value={cronExpression}
            onChange={(e) => setCronExpression(e.target.value)}
            placeholder="e.g., 0 9 * * 1-5 (leave empty for one-off task)"
            className="mt-1 font-mono text-xs"
          />
          <div className="flex flex-wrap gap-1 mt-1.5">
            {CRON_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => setCronExpression(preset.value)}
                className={cn(
                  "px-2 py-0.5 text-[11px] rounded-md transition-colors",
                  cronExpression === preset.value
                    ? "bg-primary/20 text-primary"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
          {cronError && (
            <p className="text-xs text-destructive mt-1">{cronError}</p>
          )}
          {!cronError && cronExpression && (
            <p className="text-xs text-muted-foreground mt-1">
              {describeCron(cronExpression)}
              {cronPreview && cronPreview.length > 0 && (
                <span className="block text-[11px] text-muted-foreground/60 mt-0.5">
                  Next: {cronPreview.slice(0, 3).map((t) => new Date(t).toLocaleString()).join(" | ")}
                </span>
              )}
            </p>
          )}
          {!cronExpression && (
            <p className="text-[11px] text-muted-foreground/60 mt-1">
              Leave empty for a one-off task. You can run it manually anytime.
            </p>
          )}
        </div>

        {/* Prompt */}
        <div>
          <label className="text-xs text-muted-foreground font-medium">Prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={"e.g., Review all open PRs in this repository.\n1. Check out each branch\n2. Review the code changes\n3. Post a review comment with findings"}
            className={cn(inputClass, "mt-1 min-h-[120px] resize-y")}
            required
          />
          <p className="text-[11px] text-muted-foreground/60 mt-1">
            This prompt will be sent to a fresh Claude agent each time the task runs. The agent will have full access to the workspace directory.
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            className="flex-1"
            disabled={submitting || !name.trim() || !workingDirectory || !prompt.trim() || !!cronError}
          >
            {submitting && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
            {isEdit ? "Save Changes" : "Create Task"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
