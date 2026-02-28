import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Loader2, Lock, Globe, Search, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";

const PROVIDERS = [
  { id: "github", label: "GitHub" },
  { id: "gitlab", label: "GitLab" },
  { id: "azuredevops", label: "Azure DevOps" },
];

export default function GitHubCloneDialog({ open, onClose, onClone }) {
  const [provider, setProvider] = useState("github");
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [cloning, setCloning] = useState(null);
  const [cloneError, setCloneError] = useState("");

  const fetchRepos = useCallback(() => {
    setLoading(true);
    setError("");
    setRepos([]);
    setFilter("");
    setCloneError("");
    setCloning(null);
    fetch(`/api/repos/${provider}`)
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) {
          setError(data.error || "Failed to fetch repos");
        } else {
          setRepos(data);
        }
      })
      .catch(() => setError("Failed to connect to server"))
      .finally(() => {
        setLoading(false);
        setFetched(true);
      });
  }, [provider]);

  function handleProviderChange(id) {
    setProvider(id);
    // Reset state when switching providers — user must fetch again
    setRepos([]);
    setFetched(false);
    setError("");
    setFilter("");
    setCloneError("");
    setCloning(null);
  }

  async function handleClone(repo) {
    setCloning(repo.full_name);
    setCloneError("");
    try {
      await onClone(repo.full_name, provider);
    } catch (err) {
      setCloneError(err.message || "Failed to clone");
      setCloning(null);
    }
  }

  const filtered = repos.filter((r) =>
    r.full_name.toLowerCase().includes(filter.toLowerCase()) ||
    (r.description && r.description.toLowerCase().includes(filter.toLowerCase()))
  );

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <div className="p-5 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Clone Repository</h2>
          <button
            onClick={onClose}
            disabled={!!cloning}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Provider tabs */}
        <div className="flex rounded-md border border-border overflow-hidden">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => handleProviderChange(p.id)}
              disabled={!!cloning}
              className={cn(
                "flex-1 text-xs py-2 transition-colors",
                provider === p.id
                  ? "bg-primary text-primary-foreground font-medium"
                  : "bg-background text-muted-foreground hover:bg-muted"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Fetch button — shown when repos have not been loaded yet */}
        {!fetched && !loading && (
          <Button
            variant="outline"
            className="w-full"
            onClick={fetchRepos}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Fetch Repositories
          </Button>
        )}

        {/* Loading spinner */}
        {loading && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            <span className="text-sm">Loading repositories...</span>
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div className="space-y-2">
            <p className="text-destructive text-xs px-1">{error}</p>
            <Button variant="outline" size="sm" className="w-full" onClick={fetchRepos}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        )}

        {/* Repo list — shown after successful fetch */}
        {fetched && !loading && !error && (
          <>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Filter repositories..."
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="pl-8 h-8 text-sm"
                  autoFocus
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchRepos}
                disabled={!!cloning}
                title="Refresh"
                className="shrink-0 h-8 w-8 p-0"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>

            {cloneError && <p className="text-destructive text-xs px-1">{cloneError}</p>}

            <div className="max-h-72 overflow-y-auto space-y-0.5 rounded-md border border-border">
              {filtered.length === 0 && (
                <p className="text-xs text-muted-foreground px-3 py-6 text-center">
                  {filter ? "No matching repositories" : "No repositories found"}
                </p>
              )}
              {filtered.map((repo) => (
                <button
                  key={repo.full_name}
                  onClick={() => handleClone(repo)}
                  disabled={!!cloning}
                  className={cn(
                    "w-full text-left px-3 py-2 text-sm transition-colors",
                    "hover:bg-sidebar-accent/50 disabled:opacity-50",
                    cloning === repo.full_name && "bg-sidebar-accent"
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    {repo.private ? (
                      <Lock className="h-3 w-3 shrink-0 text-yellow-500" />
                    ) : (
                      <Globe className="h-3 w-3 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate font-medium">{repo.full_name}</span>
                    {cloning === repo.full_name && (
                      <Loader2 className="h-3 w-3 animate-spin shrink-0 ml-auto" />
                    )}
                  </div>
                  {repo.description && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5 pl-[18px]">
                      {repo.description}
                    </p>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
