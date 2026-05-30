import { useState, useEffect } from "react";
import { Loader2, ListTodo, FolderOpen, Search, Cpu, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { CRON_PRESETS, describeCron } from "@/lib/cron";
import { MODEL_OPTIONS } from "@/lib/models";
import { cn } from "@/lib/utils";
import WorkflowGraph from "@/components/WorkflowGraph";
import AuthoringDialog from "@/components/AuthoringDialog";

export default function TaskForm({ open, onClose, onSubmit, initial }) {
  const [name, setName] = useState(initial?.name || "");
  const [workingDirectory, setWorkingDirectory] = useState(initial?.workingDirectory || "");
  const [cronExpression, setCronExpression] = useState(initial?.cronExpression || "");
  const [prompt, setPrompt] = useState(initial?.prompt || "");
  const [model, setModel] = useState(initial?.model || "");
  const [emails, setEmails] = useState(initial?.emails ? initial.emails.join(", ") : "");
  const [kind, setKind] = useState(initial?.kind === "workflow" ? "workflow" : "task");
  const [workflowSource, setWorkflowSource] = useState(initial?.workflowSource || "");
  const [wfValidation, setWfValidation] = useState(null); // { valid, errors, graph }
  const [showAuthoring, setShowAuthoring] = useState(false);
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
      setModel(initial?.model || "");
      setEmails(initial?.emails ? initial.emails.join(", ") : "");
      setKind(initial?.kind === "workflow" ? "workflow" : "task");
      setWorkflowSource(initial?.workflowSource || "");
      setWfValidation(null);
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

  // Validate workflow DSL (debounced) when in workflow mode
  useEffect(() => {
    if (kind !== "workflow" || !workflowSource.trim()) { setWfValidation(null); return; }
    const timer = setTimeout(() => {
      fetch("/api/tasks/validate-workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowSource }),
      })
        .then((r) => r.json())
        .then((data) => setWfValidation(data))
        .catch(() => setWfValidation(null));
    }, 400);
    return () => clearTimeout(timer);
  }, [kind, workflowSource]);

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
        model: model || null,
        kind,
        workflowSource: kind === "workflow" ? workflowSource : null,
        emails: emails
          .split(",")
          .map((e) => e.trim())
          .filter((e) => e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)),
      });
      onClose();
    } catch (err) {
      setError(err.message || "Failed to save task");
    } finally {
      setSubmitting(false);
    }
  }

  const emailList = emails
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  const invalidEmails = emailList.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

  const filteredWorkspaces = workspaces.filter((ws) =>
    ws.name.toLowerCase().includes(workspaceFilter.toLowerCase())
  );

  const selectedWorkspaceName = workspaces.find((ws) => ws.path === workingDirectory)?.name;

  const inputClass = "w-full px-3 py-2 text-sm rounded-md border border-input bg-background";

  return (
    <Dialog open={open} onClose={onClose} className="max-w-[calc(100vw-4rem)] w-full max-h-[calc(100vh-4rem)] h-full overflow-hidden">
      <form onSubmit={handleSubmit} className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center gap-2 px-6 py-4 border-b border-border shrink-0">
          <ListTodo className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-base font-semibold">{isEdit ? "Edit Task" : "New Task"}</h2>
          <div className="flex-1" />
          <Button type="button" variant="ghost" size="sm" className="text-xs h-7 text-muted-foreground" onClick={onClose}>
            Esc
          </Button>
        </div>

        {error && (
          <div className="text-xs text-destructive bg-destructive/10 mx-6 mt-4 rounded-md px-3 py-2">{error}</div>
        )}

        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6 max-w-5xl mx-auto">
            {/* Left Column */}
            <div className="space-y-6">
              {/* Type */}
              <div>
                <label className="text-xs text-muted-foreground font-medium">Type</label>
                <div className="flex gap-1 mt-1">
                  {["task", "workflow"].map((k) => (
                    <button key={k} type="button" onClick={() => setKind(k)}
                      className={cn("px-3 py-1 text-xs rounded-md border capitalize",
                        kind === k ? "bg-primary/20 text-primary border-primary/30"
                                   : "bg-muted text-muted-foreground border-transparent")}>
                      {k}
                    </button>
                  ))}
                </div>
              </div>

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
                    <div className={cn("mt-1 max-h-48 overflow-y-auto rounded-md border border-input", workspaces.length <= 5 && "mt-1")}>
                      {filteredWorkspaces.map((ws) => (
                        <button
                          key={ws.path}
                          type="button"
                          onClick={() => setWorkingDirectory(ws.path)}
                          className={cn(
                            "w-full text-left px-3 py-2 text-sm transition-colors",
                            "hover:bg-accent",
                            workingDirectory === ws.path && "bg-accent font-medium text-primary"
                          )}
                        >
                          <span className="truncate block flex items-center gap-1.5">
                            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
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

              {/* Model */}
              <div>
                <label className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                  <Cpu className="h-3 w-3" />
                  Model
                </label>
                <div className="flex flex-wrap gap-1 mt-1">
                  <button
                    type="button"
                    onClick={() => setModel("")}
                    className={cn(
                      "px-2 py-1 text-xs rounded-md transition-colors border",
                      !model
                        ? "bg-primary/20 text-primary border-primary/30"
                        : "bg-muted text-muted-foreground hover:text-foreground border-transparent"
                    )}
                  >
                    Default
                  </button>
                  {MODEL_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setModel(opt.value)}
                      className={cn(
                        "px-2 py-1 text-xs rounded-md transition-colors border",
                        model === opt.value
                          ? "bg-primary/20 text-primary border-primary/30"
                          : "bg-muted text-muted-foreground hover:text-foreground border-transparent"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground/60 mt-1">
                  {model ? MODEL_OPTIONS.find((m) => m.value === model)?.description || model : "Uses the default model configured in Claude settings."}
                </p>
              </div>

              {/* Email Notifications */}
              <div>
                <label className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                  <Mail className="h-3 w-3" />
                  Email Notifications (Optional)
                </label>
                <Input
                  value={emails}
                  onChange={(e) => setEmails(e.target.value)}
                  placeholder="e.g., alice@example.com, bob@example.com"
                  className="mt-1"
                />
                {emailList.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {emailList.map((email, i) => (
                      <span
                        key={i}
                        className={cn(
                          "px-2 py-0.5 text-[11px] rounded-full",
                          invalidEmails.includes(email)
                            ? "bg-destructive/20 text-destructive"
                            : "bg-primary/10 text-primary"
                        )}
                      >
                        {email}
                      </span>
                    ))}
                  </div>
                )}
                {invalidEmails.length > 0 && (
                  <p className="text-xs text-destructive mt-1">
                    Invalid email{invalidEmails.length > 1 ? "s" : ""}: {invalidEmails.join(", ")}
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground/60 mt-1">
                  Comma-separated list. A summary link will be emailed after each run completes. Requires a Resend API token in Settings.
                </p>
              </div>
            </div>

            {/* Right Column - Prompt or Workflow editor */}
            {kind === "workflow" ? (
              <div className="flex flex-col">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground font-medium">Workflow Definition (JSON)</label>
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs"
                    onClick={() => setShowAuthoring(true)}>Author with AI</Button>
                </div>
                <textarea
                  value={workflowSource}
                  onChange={(e) => setWorkflowSource(e.target.value)}
                  placeholder={'{ "name": "My Workflow", "start": "step1", "nodes": { } }'}
                  className={cn(inputClass, "mt-1 min-h-[220px] resize-y font-mono text-xs")}
                />
                {wfValidation && !wfValidation.valid && (
                  <ul className="mt-2 text-[11px] text-destructive list-disc pl-4">
                    {wfValidation.errors.slice(0, 8).map((er, i) => (
                      <li key={i}>{er.nodeId ? `[${er.nodeId}] ` : ""}{er.message}</li>
                    ))}
                  </ul>
                )}
                {wfValidation?.graph && (
                  <div className="mt-3 border border-border rounded-md p-2 overflow-auto max-h-[320px]">
                    <WorkflowGraph graph={wfValidation.graph} startId={(() => { try { return JSON.parse(workflowSource).start; } catch { return null; } })()} />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground font-medium">Prompt</label>
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs"
                    onClick={() => setShowAuthoring(true)}>Author with AI</Button>
                </div>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={"e.g., Review all open PRs in this repository.\n1. Check out each branch\n2. Review the code changes\n3. Post a review comment with findings"}
                  className={cn(inputClass, "mt-1 flex-1 min-h-[320px] resize-y")}
                />
                <p className="text-[11px] text-muted-foreground/60 mt-1">
                  This prompt will be sent to a fresh Claude agent each time the task runs. The agent will have full access to the workspace directory.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex gap-3 px-6 py-4 border-t border-border shrink-0">
          <div className="flex-1" />
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={submitting || !name.trim() || !workingDirectory || (kind === "task" && !prompt.trim()) || !!cronError || invalidEmails.length > 0 || (kind === "workflow" && wfValidation && !wfValidation.valid)}
          >
            {submitting && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
            {isEdit ? "Save Changes" : "Create Task"}
          </Button>
        </div>
      </form>
      <AuthoringDialog
        open={showAuthoring}
        onClose={() => setShowAuthoring(false)}
        mode={kind}
        currentDraft={kind === "workflow" ? workflowSource : prompt}
        onApply={(draft) => { if (kind === "workflow") setWorkflowSource(draft); else setPrompt(draft); }}
      />
    </Dialog>
  );
}
