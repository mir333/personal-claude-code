import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Loader2, Lock, Globe, Search, RefreshCw, X, User } from "lucide-react";
import { cn } from "@/lib/utils";

const PROVIDER_LABELS = {
  github: "GitHub",
  gitlab: "GitLab",
  azuredevops: "Azure DevOps",
};

/**
 * Generic Clone Repository dialog.
 *
 * Flow:
 *  1. Fetches all configured accounts across all providers from /api/git-config
 *  2. Presents a flat list of account labels (e.g. "Personal — GitHub", "Work — GitHub")
 *     so the user picks *which account* to clone from
 *  3. Once an account is selected, fetches repos for that provider+account
 *  4. User picks a repo → onClone(repoFullName, provider, accountId)
 */
export default function CloneDialog({ open, onClose, onClone }) {
  // All accounts across all providers: [{ id, label, provider, hasToken }]
  const [allAccounts, setAllAccounts] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  // Selected account
  const [selectedAccount, setSelectedAccount] = useState(null);

  // Repos for the selected account
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [cloning, setCloning] = useState(null);
  const [cloneError, setCloneError] = useState("");

  // Reset all state when dialog closes
  useEffect(() => {
    if (!open) {
      setAllAccounts([]);
      setSelectedAccount(null);
      setRepos([]);
      setLoading(false);
      setFetched(false);
      setError("");
      setFilter("");
      setCloning(null);
      setCloneError("");
      setLoadingAccounts(false);
      return;
    }
    // Fetch configured accounts when dialog opens
    setLoadingAccounts(true);
    fetch("/api/git-config")
      .then((r) => r.json())
      .then((data) => {
        const accounts = (data.accounts || [])
          .filter((a) => a.hasToken)
          .map((a) => ({
            id: a.id,
            label: a.label || "Default",
            provider: a.type,
            providerLabel: PROVIDER_LABELS[a.type] || a.type,
          }));
        setAllAccounts(accounts);
        // Auto-select if there's exactly one account
        if (accounts.length === 1) {
          setSelectedAccount(accounts[0]);
        }
      })
      .catch(() => setAllAccounts([]))
      .finally(() => setLoadingAccounts(false));
  }, [open]);

  const fetchRepos = useCallback(() => {
    if (!selectedAccount) return;
    setLoading(true);
    setError("");
    setRepos([]);
    setFilter("");
    setCloneError("");
    setCloning(null);
    fetch(`/api/repos/${selectedAccount.provider}?accountId=${selectedAccount.id}`)
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
  }, [selectedAccount]);

  // Auto-fetch repos when an account is selected
  useEffect(() => {
    if (selectedAccount) {
      setRepos([]);
      setFetched(false);
      setError("");
      setFilter("");
      setCloneError("");
      setCloning(null);
      // Auto-fetch immediately
      setLoading(true);
      fetch(`/api/repos/${selectedAccount.provider}?accountId=${selectedAccount.id}`)
        .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
        .then(({ ok, data }) => {
          if (!ok) setError(data.error || "Failed to fetch repos");
          else setRepos(data);
        })
        .catch(() => setError("Failed to connect to server"))
        .finally(() => { setLoading(false); setFetched(true); });
    }
  }, [selectedAccount]);

  function handleBack() {
    setSelectedAccount(null);
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
      await onClone(repo.full_name, selectedAccount.provider, selectedAccount.id);
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
          <div className="flex items-center gap-2">
            {selectedAccount && allAccounts.length > 1 && (
              <button
                onClick={handleBack}
                disabled={!!cloning}
                className="text-muted-foreground hover:text-foreground transition-colors text-sm"
                title="Back to account selection"
              >
                {"\u2190"}
              </button>
            )}
            <h2 className="text-sm font-semibold text-foreground">
              {selectedAccount
                ? `${selectedAccount.label} — ${selectedAccount.providerLabel}`
                : "Clone Repository"}
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={!!cloning}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Phase 1: Account selection */}
        {!selectedAccount && (
          <>
            {loadingAccounts ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                <span className="text-sm">Loading accounts...</span>
              </div>
            ) : allAccounts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <User className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No accounts configured.</p>
                <p className="text-xs mt-1">Add a token in Settings first.</p>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground px-1 mb-2">Select an account to browse repositories:</p>
                {allAccounts.map((acc) => (
                  <button
                    key={acc.id}
                    onClick={() => setSelectedAccount(acc)}
                    className={cn(
                      "w-full text-left px-3 py-2.5 text-sm rounded-md transition-colors",
                      "border border-border hover:bg-sidebar-accent/50 hover:border-primary/30"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                        <span className="text-xs font-medium">{acc.label?.charAt(0)?.toUpperCase() || "?"}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{acc.label}</div>
                        <div className="text-xs text-muted-foreground">{acc.providerLabel}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* Phase 2: Repo browsing for selected account */}
        {selectedAccount && (
          <>
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

            {/* Repo list */}
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
          </>
        )}
      </div>
    </Dialog>
  );
}
