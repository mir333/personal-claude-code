import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Lock, Globe, ArrowLeft, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export default function GitHubClonePanel({ onClone, onCancel }) {
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [cloning, setCloning] = useState(null); // full_name of repo being cloned
  const [cloneError, setCloneError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    fetch("/api/github/repos")
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) {
          setError(data.error || "Failed to fetch repos");
        } else {
          setRepos(data);
        }
      })
      .catch(() => setError("Failed to connect to server"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = repos.filter((r) =>
    r.full_name.toLowerCase().includes(filter.toLowerCase()) ||
    (r.description && r.description.toLowerCase().includes(filter.toLowerCase()))
  );

  async function handleClone(repo) {
    setCloning(repo.full_name);
    setCloneError("");
    try {
      await onClone(repo.full_name);
    } catch (err) {
      setCloneError(err.message || "Failed to clone");
      setCloning(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          onClick={onCancel}
          className="text-muted-foreground hover:text-foreground shrink-0"
          disabled={!!cloning}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Clone from GitHub
        </p>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-6 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          <span className="text-sm">Loading repositories...</span>
        </div>
      )}

      {error && (
        <div className="space-y-2">
          <p className="text-destructive text-xs px-1">{error}</p>
          <Button variant="ghost" size="sm" className="w-full" onClick={onCancel}>
            Back
          </Button>
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Filter repositories..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="pl-7 h-8 text-sm"
              autoFocus
            />
          </div>
          {cloneError && <p className="text-destructive text-xs px-1">{cloneError}</p>}
          <div className="max-h-64 overflow-y-auto space-y-0.5 rounded-md border border-border">
            {filtered.length === 0 && (
              <p className="text-xs text-muted-foreground px-3 py-4 text-center">
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
          <Button variant="ghost" size="sm" className="w-full" onClick={onCancel} disabled={!!cloning}>
            Cancel
          </Button>
        </>
      )}
    </div>
  );
}
