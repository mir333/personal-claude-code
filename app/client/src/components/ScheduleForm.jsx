import { useState, useEffect } from "react";
import { Loader2, Clock, GitBranch, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { CRON_PRESETS, describeCron } from "@/lib/cron";
import { cn } from "@/lib/utils";

const PROVIDERS = [
  { id: "github", label: "GitHub" },
  { id: "gitlab", label: "GitLab" },
  { id: "azuredevops", label: "Azure DevOps" },
];

export default function ScheduleForm({ open, onClose, onSubmit, initial }) {
  const [name, setName] = useState(initial?.name || "");
  const [provider, setProvider] = useState(initial?.provider || "github");
  const [repoFullName, setRepoFullName] = useState(initial?.repoFullName || "");
  const [cronExpression, setCronExpression] = useState(initial?.cronExpression || "0 9 * * 1-5");
  const [prompt, setPrompt] = useState(initial?.prompt || "");
  const [repos, setRepos] = useState([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [repoFilter, setRepoFilter] = useState("");
  const [cronPreview, setCronPreview] = useState(null);
  const [cronError, setCronError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isEdit = !!initial;

  // Reset form when opened
  useEffect(() => {
    if (open) {
      setName(initial?.name || "");
      setProvider(initial?.provider || "github");
      setRepoFullName(initial?.repoFullName || "");
      setCronExpression(initial?.cronExpression || "0 9 * * 1-5");
      setPrompt(initial?.prompt || "");
      setError("");
      setCronError("");
    }
  }, [open, initial]);

  // Load repos when provider changes
  useEffect(() => {
    if (!open) return;
    setReposLoading(true);
    setRepos([]);
    fetch(`/api/repos/${provider}`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load repos");
        return r.json();
      })
      .then((data) => setRepos(data))
      .catch(() => setRepos([]))
      .finally(() => setReposLoading(false));
  }, [provider, open]);

  // Validate cron expression
  useEffect(() => {
    if (!cronExpression.trim()) {
      setCronPreview(null);
      setCronError("");
      return;
    }
    const timer = setTimeout(() => {
      fetch("/api/schedules/validate-cron", {
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
        provider,
        repoFullName,
        cronExpression,
        prompt: prompt.trim(),
      });
      onClose();
    } catch (err) {
      setError(err.message || "Failed to save schedule");
    } finally {
      setSubmitting(false);
    }
  }

  const filteredRepos = repos.filter((r) =>
    r.full_name.toLowerCase().includes(repoFilter.toLowerCase())
  );

  const inputClass = "w-full px-3 py-2 text-sm rounded-md border border-input bg-background";

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">{isEdit ? "Edit Schedule" : "New Scheduled Task"}</h2>
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
            placeholder="e.g., Daily PR Review"
            className="mt-1"
            required
          />
        </div>

        {/* Provider */}
        <div>
          <label className="text-xs text-muted-foreground font-medium">Git Provider</label>
          <div className="flex gap-1 mt-1">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setProvider(p.id)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                  provider === p.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Repository */}
        <div>
          <label className="text-xs text-muted-foreground font-medium">Repository</label>
          {reposLoading ? (
            <div className="flex items-center gap-2 mt-1 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading repos...
            </div>
          ) : repos.length === 0 ? (
            <div className="mt-1 text-xs text-muted-foreground py-2">
              No repos found. Make sure your {PROVIDERS.find((p) => p.id === provider)?.label} token is configured in Settings.
            </div>
          ) : (
            <>
              <div className="relative mt-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  placeholder="Filter repos..."
                  value={repoFilter}
                  onChange={(e) => setRepoFilter(e.target.value)}
                  className="pl-8 h-8 text-xs"
                />
              </div>
              <div className="mt-1 max-h-36 overflow-y-auto rounded-md border border-input">
                {filteredRepos.slice(0, 50).map((repo) => (
                  <button
                    key={repo.full_name}
                    type="button"
                    onClick={() => setRepoFullName(repo.full_name)}
                    className={cn(
                      "w-full text-left px-3 py-1.5 text-xs transition-colors",
                      "hover:bg-accent",
                      repoFullName === repo.full_name && "bg-accent font-medium text-primary"
                    )}
                  >
                    <span className="truncate block">{repo.full_name}</span>
                    {repo.description && (
                      <span className="truncate block text-muted-foreground/60 text-[11px]">{repo.description}</span>
                    )}
                  </button>
                ))}
                {filteredRepos.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-3">No matching repos</p>
                )}
              </div>
              {repoFullName && (
                <p className="text-xs text-primary mt-1 flex items-center gap-1">
                  <GitBranch className="h-3 w-3" />
                  {repoFullName}
                </p>
              )}
            </>
          )}
        </div>

        {/* Cron Expression */}
        <div>
          <label className="text-xs text-muted-foreground font-medium">Schedule (Cron Expression)</label>
          <Input
            value={cronExpression}
            onChange={(e) => setCronExpression(e.target.value)}
            placeholder="0 9 * * 1-5"
            className="mt-1 font-mono text-xs"
            required
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
        </div>

        {/* Prompt */}
        <div>
          <label className="text-xs text-muted-foreground font-medium">Prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={"Review all open PRs in this repository. For each PR:\n1. Check out the branch\n2. Review the code changes\n3. Post a review comment with findings"}
            className={cn(inputClass, "mt-1 min-h-[120px] resize-y")}
            required
          />
          <p className="text-[11px] text-muted-foreground/60 mt-1">
            This prompt will be sent to a fresh Claude agent each time the schedule runs. The agent will have full access to the cloned repository.
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
            disabled={submitting || !name.trim() || !repoFullName || !cronExpression || !prompt.trim() || !!cronError}
          >
            {submitting && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
            {isEdit ? "Save Changes" : "Create Schedule"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
