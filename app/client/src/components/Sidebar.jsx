import { useState, useEffect, useRef } from "react";
import { FolderOpen, Plus, Circle, BellRing, BellOff, GitBranch, Settings, Loader2, Download, ChevronRight, Search, LogOut, Clock, RefreshCw, AlertTriangle, X, Trash2, Key, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import NewAgentForm from "./NewAgentForm.jsx";
import CloneDialog from "./ClonePanel.jsx";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const STATUS_COLORS = {
  idle: "text-green-500",
  busy: "text-yellow-500",
  error: "text-red-500",
};

const GIT_STATE = {
  dirty: { color: "text-yellow-500", label: "Uncommitted changes" },
  ahead: { color: "text-blue-500", label: "Unpushed commits" },
  clean: { color: "text-green-500", label: "Up to date" },
};

/* ------------------------------------------------------------------ */
/*  Inline branch state indicator (shown next to branch name)          */
/* ------------------------------------------------------------------ */
function BranchStateIndicator({ git }) {
  if (!git || !git.isRepo) return null;
  const info = GIT_STATE[git.state] || GIT_STATE.clean;
  return (
    <span className={cn("text-[10px] shrink-0", info.color)} title={info.label}>
      {git.state === "dirty" && "*"}
      {git.state === "ahead" && git.unpushed > 0 && `${git.unpushed}\u2191`}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Add Worktree Dialog (branch picker dropdown)                       */
/* ------------------------------------------------------------------ */
function AddWorktreeDropdown({ agentId, onCreated, onClose }) {
  const [branches, setBranches] = useState([]);
  const [existingWorktrees, setExistingWorktrees] = useState({});
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(null);
  const [error, setError] = useState("");
  const [newBranchMode, setNewBranchMode] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  useEffect(() => {
    setLoading(true);
    setError("");
    fetch(`/api/agents/${agentId}/branches`)
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (ok) {
          setBranches(data.branches || []);
          setExistingWorktrees(data.worktrees || {});
        } else {
          setError(data.error || "Failed to load branches");
        }
      })
      .catch(() => setError("Failed to load branches"))
      .finally(() => setLoading(false));
  }, [agentId]);

  async function handleSelect(branchName, createBranch = false) {
    setCreating(branchName);
    setError("");
    try {
      const res = await fetch(`/api/agents/${agentId}/worktree`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch: branchName, createBranch }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onCreated(data);
    } catch (err) {
      setError(err.message || "Failed to create worktree");
      setCreating(null);
    }
  }

  async function handleCreateNewBranch() {
    const name = newBranchName.trim();
    if (!name) return;
    await handleSelect(name, true);
  }

  // Filter branches, excluding those that already have worktrees
  const filtered = branches.filter((b) =>
    b.name.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div ref={dropdownRef} className="absolute left-0 top-full mt-1 z-50 w-56 rounded-md border border-border bg-popover shadow-md">
      <div className="p-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            placeholder="Filter branches..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-7 h-7 text-xs"
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </div>
      {error && <p className="text-destructive text-xs px-3 pb-2">{error}</p>}
      {loading ? (
        <div className="flex items-center justify-center py-4 text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
          <span className="text-xs">Loading...</span>
        </div>
      ) : (
        <div className="max-h-52 overflow-y-auto pb-1">
          {/* New branch option */}
          {newBranchMode ? (
            <div className="px-2 py-1.5">
              <div className="flex items-center gap-1">
                <Input
                  placeholder="Branch name..."
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  className="h-6 text-xs flex-1"
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreateNewBranch(); if (e.key === "Escape") setNewBranchMode(false); }}
                />
                <button
                  onClick={(e) => { e.stopPropagation(); handleCreateNewBranch(); }}
                  disabled={!newBranchName.trim() || !!creating}
                  className="text-xs px-2 py-0.5 bg-primary text-primary-foreground rounded disabled:opacity-50 shrink-0"
                >
                  {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : "Create"}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); setNewBranchMode(true); }}
              className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors hover:bg-accent text-primary"
            >
              <Plus className="h-3 w-3 shrink-0" />
              <span>Create new branch</span>
            </button>
          )}
          <Separator className="my-1" />
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-3">
              {filter ? "No matching branches" : "No branches found"}
            </p>
          )}
          {filtered.map((b) => {
            const hasWorktree = !!existingWorktrees[b.name];
            return (
              <button
                key={b.name}
                onClick={(e) => { e.stopPropagation(); if (!hasWorktree) handleSelect(b.name); }}
                disabled={hasWorktree || !!creating}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors",
                  hasWorktree
                    ? "opacity-40 cursor-default"
                    : "hover:bg-accent disabled:opacity-50",
                )}
              >
                <GitBranch className="h-3 w-3 shrink-0" />
                <span className="truncate flex-1">{b.name}</span>
                {!b.local && <span className="text-muted-foreground/60 shrink-0">remote</span>}
                {hasWorktree && <span className="text-muted-foreground/60 shrink-0 text-[10px]">active</span>}
                {creating === b.name && <Loader2 className="h-3 w-3 animate-spin shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Project item with worktree sub-items                               */
/* ------------------------------------------------------------------ */
function ProjectItem({
  project,
  gitStatuses,
  selectedId,
  onSelect,
  onCreate,
  onDeleteProject,
  onAddWorktree,
  onRemoveWorktree,
  onRemoveWorktreeByPath,
  onDeleteAllLocalBranches,
  findAgentByWorkDir,
}) {
  const [expanded, setExpanded] = useState(true);
  const [addingWorktree, setAddingWorktree] = useState(false);

  const isRepo = project.isRepo && project.worktrees && project.worktrees.length > 0;
  const hasAnySelected = project.worktrees?.some((wt) => {
    const agent = findAgentByWorkDir(wt.path);
    return agent && agent.id === selectedId;
  });

  // For non-git projects or repos with no worktree data, fall back to single-item behavior
  if (!isRepo) {
    const agent = findAgentByWorkDir(project.path);
    const isSelected = agent && agent.id === selectedId;
    return (
      <div
        onClick={() => {
          if (agent) {
            onSelect(agent.id);
          } else {
            onCreate(project.name, project.path).then((a) => onSelect(a.id));
          }
        }}
        className={cn(
          "w-full flex items-center gap-2 rounded-md px-2 py-2 text-sm text-left transition-colors cursor-pointer group",
          isSelected
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "hover:bg-sidebar-accent/50"
        )}
      >
        <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate">{project.name}</div>
        </div>
        {agent && (
          <Circle
            className={cn("h-2.5 w-2.5 shrink-0 fill-current", STATUS_COLORS[agent.status] || "text-muted-foreground")}
          />
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Delete project "${project.name}"? This will permanently remove the directory and all its files.`)) {
              onDeleteProject(project.name, agent?.id);
            }
          }}
          className="text-muted-foreground hover:text-destructive text-sm shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  // Find an agent for this project (use main worktree agent as the reference for add-worktree calls)
  const mainWorktree = project.worktrees.find((wt) => wt.isMain);
  const mainAgent = mainWorktree ? findAgentByWorkDir(mainWorktree.path) : null;

  return (
    <div>
      {/* Project header row */}
      <div
        className={cn(
          "w-full flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-left transition-colors cursor-pointer group",
          hasAnySelected ? "text-sidebar-accent-foreground" : ""
        )}
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight className={cn("h-3 w-3 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")} />
        <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate flex-1 font-medium">{project.name}</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Delete project "${project.name}"? This will permanently remove the directory, all worktrees, and their files.`)) {
              onDeleteProject(project.name, mainAgent?.id);
            }
          }}
          className="text-muted-foreground hover:text-destructive text-sm shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Worktree children */}
      {expanded && (
        <div className="ml-4 pl-2 border-l border-border/50">
          {project.worktrees.map((wt) => {
            const agent = findAgentByWorkDir(wt.path);
            const isSelected = agent && agent.id === selectedId;
            const git = agent ? gitStatuses[agent.id] : null;

            return (
              <div
                key={wt.path}
                onClick={() => {
                  if (agent) {
                    onSelect(agent.id);
                  } else {
                    // Auto-create agent for this worktree path
                    onCreate(project.name + " (" + wt.branch + ")", wt.path).then((a) => onSelect(a.id));
                  }
                }}
                className={cn(
                  "w-full flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-left transition-colors cursor-pointer group",
                  isSelected
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/50"
                )}
              >
                <GitBranch className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="truncate flex-1 text-xs">{wt.branch || "(detached)"}</span>
                <BranchStateIndicator git={git} />
                {agent && (
                  <Circle
                    className={cn("h-2 w-2 shrink-0 fill-current", STATUS_COLORS[agent.status] || "text-muted-foreground")}
                  />
                )}
                {!wt.isMain && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Remove worktree "${wt.branch}"? This will delete the working directory for this branch.`)) {
                        if (agent) {
                          onRemoveWorktree(agent.id);
                        } else {
                          onRemoveWorktreeByPath(project.name, wt.path);
                        }
                      }
                    }}
                    className="text-muted-foreground hover:text-destructive shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}

          {/* Add worktree button */}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                // Ensure main agent exists first
                if (!mainAgent) {
                  onCreate(project.name, project.path).then(() => setAddingWorktree(true));
                } else {
                  setAddingWorktree(!addingWorktree);
                }
              }}
              className="w-full flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-left transition-colors hover:bg-sidebar-accent/50 text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-3 w-3 shrink-0" />
              <span>Another</span>
            </button>
            {addingWorktree && mainAgent && (
              <AddWorktreeDropdown
                agentId={mainAgent.id}
                onCreated={(data) => {
                  setAddingWorktree(false);
                  onAddWorktree(data);
                }}
                onClose={() => setAddingWorktree(false)}
              />
            )}
          </div>

          {/* Remove all local branches button */}
          {mainAgent && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Remove all local branches from "${project.name}"?\n\nThis will delete all local branches except the current branch, default branch (main/master), and branches with active worktrees.`)) {
                  onDeleteAllLocalBranches(mainAgent.id);
                }
              }}
              className="w-full flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-left transition-colors hover:bg-sidebar-accent/50 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3 w-3 shrink-0" />
              <span>Remove local branches</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Settings panel — multi-account support per provider                */
/* ------------------------------------------------------------------ */
const SETTINGS_TABS = [
  { id: "user", label: "User" },
  { id: "github", label: "GitHub" },
  { id: "gitlab", label: "GitLab" },
  { id: "azuredevops", label: "Azure DevOps" },
  { id: "apitokens", label: "API Tokens" },
  { id: "envvars", label: "Env Vars" },
];

const PROVIDER_HINTS = {
  github: {
    tokenHint: (linkClass) => (
      <span>
        Generate at{" "}
        <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" className={linkClass}>
          github.com/settings/tokens
        </a>
        . Select "Classic" token with <b>repo</b> scope.
      </span>
    ),
    extraFields: [],
  },
  gitlab: {
    tokenHint: (linkClass) => (
      <span>
        Generate at{" "}
        <a href="https://gitlab.com/-/user_settings/personal_access_tokens" target="_blank" rel="noopener noreferrer" className={linkClass}>
          GitLab &gt; Settings &gt; Access Tokens
        </a>
        . Select scopes: <b>api</b>, <b>read_repository</b>, <b>write_repository</b>.
      </span>
    ),
    extraFields: [{ key: "url", label: "URL", placeholder: "https://gitlab.com", hint: "Change for self-hosted GitLab instances." }],
  },
  azuredevops: {
    tokenHint: (linkClass) => (
      <span>
        Generate at{" "}
        <a href="https://dev.azure.com" target="_blank" rel="noopener noreferrer" className={linkClass}>
          dev.azure.com
        </a>
        {" "}&gt; User Settings &gt; Personal Access Tokens. Select scope: <b>Code (Read &amp; Write)</b>.
      </span>
    ),
    extraFields: [{ key: "organization", label: "Organization", placeholder: "my-org", hint: "Your Azure DevOps organization name from the URL: dev.azure.com/org-name" }],
  },
};

function SaveButton({ saving, saved, onClick }) {
  return (
    <Button variant="outline" size="sm" className="w-full" onClick={onClick} disabled={saving}>
      {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
      {saved ? "Saved!" : "Save"}
    </Button>
  );
}

function useSettingsSave(buildBody, onSuccess) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/git-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody()),
      });
      const data = await res.json();
      if (onSuccess) onSuccess(data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  return { saving, saved, handleSave };
}

function UserTab({ name, setName, email, setEmail }) {
  const { saving, saved, handleSave } = useSettingsSave(() => ({ name, email }));
  const inputClass = "w-full mt-1 px-2 py-1.5 text-sm rounded-md border border-input bg-background";

  return (
    <div className="space-y-2">
      <div>
        <label className="text-xs text-muted-foreground">User Name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Your Name" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Email</label>
        <input type="text" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="you@example.com" />
      </div>
      <SaveButton saving={saving} saved={saved} onClick={handleSave} />
    </div>
  );
}

/**
 * Generic multi-account provider tab.
 * Works with the flat accounts array — filters by type (providerKey).
 * Supports add / remove operations. Saves the full list back to the server.
 */
function ProviderAccountsTab({ providerKey, allAccounts, onAccountsUpdated }) {
  const hints = PROVIDER_HINTS[providerKey];
  const inputClass = "w-full mt-1 px-2 py-1.5 text-sm rounded-md border border-input bg-background";
  const hintClass = "text-[11px] text-muted-foreground/70 mt-1 leading-tight";
  const linkClass = "underline hover:text-foreground";

  // Local editable state — only the accounts for this provider type
  const [accounts, setAccounts] = useState(() =>
    allAccounts.filter((a) => a.type === providerKey).map((a) => ({ ...a, newToken: "" }))
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function updateAccount(index, field, value) {
    setAccounts((prev) => prev.map((a, i) => (i === index ? { ...a, [field]: value } : a)));
  }

  function addAccount() {
    const newAcc = { id: null, label: "", newToken: "", hasToken: false, type: providerKey };
    for (const f of hints.extraFields) {
      newAcc[f.key] = f.key === "url" ? "https://gitlab.com" : "";
    }
    setAccounts((prev) => [...prev, newAcc]);
  }

  function removeAccount(index) {
    setAccounts((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      // Build the full flat array: other provider accounts untouched + this provider's edited accounts
      const otherAccounts = allAccounts.filter((a) => a.type !== providerKey);
      const theseAccounts = accounts.map((a) => {
        const entry = { id: a.id || undefined, label: a.label, type: providerKey };
        if (a.newToken) entry.token = a.newToken;
        for (const f of hints.extraFields) {
          entry[f.key] = a[f.key] || "";
        }
        return entry;
      });

      const res = await fetch("/api/git-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts: [...otherAccounts, ...theseAccounts] }),
      });
      const data = await res.json();

      // Refresh from server response
      const updatedAll = data.accounts || [];
      setAccounts(updatedAll.filter((a) => a.type === providerKey).map((a) => ({ ...a, newToken: "" })));
      if (onAccountsUpdated) onAccountsUpdated(updatedAll);

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {accounts.map((account, i) => (
        <div key={account.id || `new-${i}`} className="relative space-y-1.5 p-2.5 rounded-md border border-border">
          {/* Header row: label + remove */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={account.label}
              onChange={(e) => updateAccount(i, "label", e.target.value)}
              className="flex-1 px-2 py-1 text-sm rounded-md border border-input bg-background"
              placeholder="Label (e.g., Personal, Work)"
            />
            {accounts.length > 1 && (
              <button
                onClick={() => removeAccount(i)}
                className="text-muted-foreground hover:text-destructive shrink-0"
                title="Remove account"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Token */}
          <div>
            <label className="text-xs text-muted-foreground">Token (PAT)</label>
            <input
              type="password"
              value={account.newToken}
              onChange={(e) => updateAccount(i, "newToken", e.target.value)}
              className={inputClass}
              placeholder={account.hasToken ? "Token configured \u2713" : "Paste token here"}
            />
            {i === 0 && <p className={hintClass}>{hints.tokenHint(linkClass)}</p>}
          </div>

          {/* Provider-specific extra fields */}
          {hints.extraFields.map((f) => (
            <div key={f.key}>
              <label className="text-xs text-muted-foreground">{f.label}</label>
              <input
                type="text"
                value={account[f.key] || ""}
                onChange={(e) => updateAccount(i, f.key, e.target.value)}
                className={inputClass}
                placeholder={f.placeholder}
              />
              {i === 0 && f.hint && <p className={hintClass}>{f.hint}</p>}
            </div>
          ))}
        </div>
      ))}

      <button
        onClick={addAccount}
        className="w-full flex items-center justify-center gap-1 py-1.5 text-xs text-muted-foreground hover:text-foreground border border-dashed border-border rounded-md transition-colors hover:border-foreground/30"
      >
        <Plus className="h-3 w-3" />
        Add Account
      </button>

      <SaveButton saving={saving} saved={saved} onClick={handleSave} />
    </div>
  );
}

/**
 * API Tokens tab — lets the user create/revoke bearer tokens that authenticate
 * against the Vercel AI SDK compatible endpoint. Each token is bound to a
 * workspace directory. An ephemeral agent is spun up on the fly per unique
 * conversation (keyed by message-prefix hash), mirroring how Tasks work.
 */
function ApiTokensTab() {
  const inputClass = "w-full mt-1 px-2 py-1.5 text-sm rounded-md border border-input bg-background";
  const hintClass = "text-[11px] text-muted-foreground/70 mt-1 leading-tight";

  const [tokens, setTokens] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [workspaces, setWorkspaces] = useState([]); // [{ name, path, isWorktree }]
  const [label, setLabel] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState("");
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState(null); // { token, label, workingDirectory }
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  async function reload() {
    try {
      const res = await fetch("/api/api-tokens");
      if (res.ok) setTokens(await res.json());
    } catch {
      // ignore
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    reload();
    // Load selectable workspaces (projects + non-main worktrees).
    fetch("/api/workspace")
      .then((r) => (r.ok ? r.json() : []))
      .then((projects) => {
        const flat = [];
        for (const p of (projects || [])) {
          flat.push({ name: p.name, path: p.path, isWorktree: false });
          for (const wt of (p.worktrees || [])) {
            if (!wt.isMain) {
              flat.push({
                name: `${p.name} (${wt.branch || "worktree"})`,
                path: wt.path,
                isWorktree: true,
              });
            }
          }
        }
        setWorkspaces(flat);
      })
      .catch(() => setWorkspaces([]));
  }, []);

  async function handleCreate() {
    setError(null);
    if (!label.trim()) {
      setError("Label is required");
      return;
    }
    if (!workingDirectory) {
      setError("Pick a workspace to bind this token to");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/api-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim(), workingDirectory }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create token");
        return;
      }
      setNewToken({ token: data.token, label: data.label, workingDirectory: data.workingDirectory });
      setLabel("");
      setWorkingDirectory("");
      reload();
    } catch (err) {
      setError(err.message || "Failed to create token");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm("Revoke this token? Any clients using it will stop working.")) return;
    try {
      await fetch(`/api/api-tokens/${id}`, { method: "DELETE" });
      reload();
    } catch {
      // ignore
    }
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  function basename(p) {
    if (!p || typeof p !== "string") return "";
    return p.split("/").filter(Boolean).pop() || p;
  }

  function workspaceLabel(p) {
    if (!p) return "(no workspace)";
    const match = workspaces.find((w) => w.path === p);
    return match ? match.name : basename(p);
  }

  const baseUrl = typeof window !== "undefined" ? `${window.location.origin}/api/v1` : "/api/v1";

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Generate bearer tokens to call this instance using the Vercel AI SDK
        (OpenAI-compatible). Each token is bound to a workspace directory.
        A fresh Claude session is started per unique conversation and reused
        for follow-ups in that conversation.
      </p>

      <div className="rounded-md border border-border p-2.5 text-[11px] text-muted-foreground font-mono bg-muted/30 break-all">
        <div>Base URL: <span className="text-foreground">{baseUrl}</span></div>
        <div>Path: <span className="text-foreground">/chat/completions</span></div>
      </div>

      {/* Reveal newly-created token once */}
      {newToken && (
        <div className="rounded-md border border-yellow-500/40 bg-yellow-500/5 p-2.5 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-yellow-700 dark:text-yellow-400">
            <Key className="h-3 w-3" />
            Copy your token now — it won't be shown again
          </div>
          <div className="flex items-center gap-1.5">
            <code className="flex-1 px-2 py-1 text-xs bg-background border border-border rounded font-mono break-all">
              {newToken.token}
            </code>
            <button
              onClick={() => copyToClipboard(newToken.token)}
              className="shrink-0 p-1 text-muted-foreground hover:text-foreground"
              title="Copy token"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
          <div className="text-[11px] text-muted-foreground" title={newToken.workingDirectory}>
            Bound to workspace: <span className="text-foreground">{workspaceLabel(newToken.workingDirectory)}</span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            Model id: <code className="text-foreground">claude-agent-{basename(newToken.workingDirectory)}</code>
          </div>
          <button
            onClick={() => setNewToken(null)}
            className="text-[11px] underline text-muted-foreground hover:text-foreground"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Create form */}
      <div className="space-y-1.5 p-2.5 rounded-md border border-border">
        <div>
          <label className="text-xs text-muted-foreground">Label</label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className={inputClass}
            placeholder="e.g. my-laptop, CI pipeline"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Bind to workspace</label>
          <select
            value={workingDirectory}
            onChange={(e) => setWorkingDirectory(e.target.value)}
            className={inputClass}
          >
            <option value="">Select a workspace…</option>
            {workspaces.map((w) => (
              <option key={w.path} value={w.path}>{w.name}</option>
            ))}
          </select>
          <p className={hintClass}>
            Requests using this token run in this workspace. An agent is created
            on the fly per unique conversation and reused for follow-ups.
          </p>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button variant="outline" size="sm" className="w-full" onClick={handleCreate} disabled={creating}>
          {creating ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
          Generate token
        </Button>
      </div>

      {/* Existing tokens */}
      <div className="space-y-1.5">
        <div className="text-xs font-medium text-muted-foreground">Existing tokens</div>
        {!loaded ? (
          <div className="flex items-center justify-center py-4 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          </div>
        ) : tokens.length === 0 ? (
          <div className="text-xs text-muted-foreground italic px-2 py-1.5">
            No tokens yet.
          </div>
        ) : (
          tokens.map((t) => (
            <div key={t.id} className="flex items-start justify-between gap-2 p-2 rounded-md border border-border">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{t.label}</div>
                <div className="text-[11px] text-muted-foreground truncate" title={t.workingDirectory || ""}>
                  Workspace: {workspaceLabel(t.workingDirectory)}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Created {new Date(t.createdAt).toLocaleDateString()}
                  {t.lastUsedAt ? ` · Last used ${new Date(t.lastUsedAt).toLocaleDateString()}` : " · Never used"}
                </div>
              </div>
              <button
                onClick={() => handleDelete(t.id)}
                className="shrink-0 p-1 text-muted-foreground hover:text-destructive"
                title="Revoke token"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Env Vars tab — lets the user set environment variables / secrets that are
 * injected into the Claude agent process.  Useful for API tokens (GitLab,
 * npm, etc.) that the AI needs when executing tools.
 */
function EnvVarsTab() {
  const inputClass = "w-full mt-1 px-2 py-1.5 text-sm rounded-md border border-input bg-background";
  const hintClass = "text-[11px] text-muted-foreground/70 mt-1 leading-tight";

  const [vars, setVars] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function reload() {
    try {
      const res = await fetch("/api/env-vars");
      if (res.ok) setVars(await res.json());
    } catch {
      // ignore
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => { reload(); }, []);

  async function handleAdd() {
    setError(null);
    const trimmed = newName.trim().toUpperCase();
    if (!trimmed) { setError("Variable name is required"); return; }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
      setError("Name must contain only letters, digits, and underscores");
      return;
    }
    if (!newValue) { setError("Value is required"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/env-vars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, value: newValue }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to save");
        return;
      }
      setNewName("");
      setNewValue("");
      reload();
    } catch (err) {
      setError(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    try {
      await fetch(`/api/env-vars/${id}`, { method: "DELETE" });
      reload();
    } catch {
      // ignore
    }
  }

  async function handleUpdate(id, name) {
    const value = prompt(`Enter new value for ${name}:`);
    if (value == null || value === "") return;
    try {
      await fetch("/api/env-vars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, value }),
      });
      reload();
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Set environment variables that are injected into every agent in this
        profile. Use these for API tokens, credentials, and other secrets the
        AI needs when running tools (e.g.{" "}
        <code className="text-foreground/80">GITLAB_TOKEN</code>,{" "}
        <code className="text-foreground/80">NPM_TOKEN</code>).
      </p>

      {/* Add form */}
      <div className="space-y-1.5 p-2.5 rounded-md border border-border">
        <div>
          <label className="text-xs text-muted-foreground">Name</label>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value.toUpperCase())}
            className={inputClass}
            placeholder="e.g. GITLAB_TOKEN"
            spellCheck={false}
          />
          <p className={hintClass}>
            Letters, digits, and underscores only. Automatically uppercased.
          </p>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Value</label>
          <input
            type="password"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            className={inputClass}
            placeholder="Paste secret value here"
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button variant="outline" size="sm" className="w-full" onClick={handleAdd} disabled={saving}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
          Set variable
        </Button>
      </div>

      {/* Existing vars */}
      <div className="space-y-1.5">
        <div className="text-xs font-medium text-muted-foreground">Configured variables</div>
        {!loaded ? (
          <div className="flex items-center justify-center py-4 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          </div>
        ) : vars.length === 0 ? (
          <div className="text-xs text-muted-foreground italic px-2 py-1.5">
            No variables configured yet.
          </div>
        ) : (
          vars.map((v) => (
            <div key={v.id} className="flex items-center justify-between gap-2 p-2 rounded-md border border-border">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-mono font-medium truncate">{v.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {v.updatedAt
                    ? `Updated ${new Date(v.updatedAt).toLocaleDateString()}`
                    : `Created ${new Date(v.createdAt).toLocaleDateString()}`}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => handleUpdate(v.id, v.name)}
                  className="p-1 text-muted-foreground hover:text-foreground"
                  title="Update value"
                >
                  <Key className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => handleDelete(v.id)}
                  className="p-1 text-muted-foreground hover:text-destructive"
                  title="Delete variable"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function GitSettingsPanel({ onClose, agents }) {
  const [activeTab, setActiveTab] = useState("user");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [accounts, setAccounts] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/git-config")
      .then((r) => r.json())
      .then((data) => {
        setName(data.name || "");
        setEmail(data.email || "");
        setAccounts(data.accounts || []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Settings</h2>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-sm leading-none">{"\u2715"}</button>
      </div>

      <div className="flex gap-1 border-b border-border">
        {SETTINGS_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-3 py-1.5 text-xs font-medium transition-colors rounded-t-md -mb-px",
              activeTab === tab.id
                ? "border border-border border-b-transparent bg-background text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {!loaded ? (
        <div className="flex items-center justify-center py-6 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          <span className="text-sm">Loading...</span>
        </div>
      ) : (
        <>
          {activeTab === "user" && <UserTab name={name} setName={setName} email={email} setEmail={setEmail} />}
          {activeTab === "github" && <ProviderAccountsTab providerKey="github" allAccounts={accounts} onAccountsUpdated={setAccounts} />}
          {activeTab === "gitlab" && <ProviderAccountsTab providerKey="gitlab" allAccounts={accounts} onAccountsUpdated={setAccounts} />}
          {activeTab === "azuredevops" && <ProviderAccountsTab providerKey="azuredevops" allAccounts={accounts} onAccountsUpdated={setAccounts} />}
          {activeTab === "apitokens" && <ApiTokensTab />}
          {activeTab === "envvars" && <EnvVarsTab />}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Sidebar component                                             */
/* ------------------------------------------------------------------ */
export default function Sidebar({
  agents,
  selectedId,
  onSelect,
  onCreate,
  onClone,
  onDelete,
  onDeleteProject,
  onRefresh,
  projects = [],
  projectsLoaded = false,
  findAgentByWorkDir,
  notificationsEnabled,
  notificationsPermissionDenied,
  toggleNotifications,
  gitStatuses = {},
  profile = null,
  onLogout,
  currentView = "chat",
  onNavigate,
  scheduleCount = 0,
  onAddWorktree,
  onRemoveWorktree,
  onRemoveWorktreeByPath,
  onDeleteAllLocalBranches,
}) {
  const [showForm, setShowForm] = useState(false);
  const [showClone, setShowClone] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [gitConfigured, setGitConfigured] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetch("/api/git-config")
      .then((r) => r.json())
      .then((data) => {
        setGitConfigured(!!data.name && !!data.email && !!data.hasToken);
      })
      .catch(() => {});
  }, [showSettings]);

  async function handleCreate(name, localOnly, provider) {
    await onCreate(name, localOnly, provider);
    setShowForm(false);
  }

  // Collect all worktree paths for "Custom Agents" filtering
  const allProjectPaths = new Set();
  for (const p of projects) {
    allProjectPaths.add(p.path);
    if (p.worktrees) {
      for (const wt of p.worktrees) {
        allProjectPaths.add(wt.path);
      }
    }
  }

  return (
    <div className="w-72 border-r border-border flex flex-col h-full bg-sidebar text-sidebar-foreground">
      <div className="p-4 pb-3">
        {profile ? (
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-white font-bold text-sm shadow-md shadow-primary/20 shrink-0">
              {profile.name?.charAt(0)?.toUpperCase() || "U"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold truncate leading-tight">{profile.name}</div>
              <div className="text-[11px] text-muted-foreground truncate">@{profile.slug}</div>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 relative"
                onClick={() => setShowSettings((v) => !v)}
                title="Git settings"
              >
                <Settings className="h-3.5 w-3.5" />
                {gitConfigured !== null && (
                  <span
                    className={cn(
                      "absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full",
                      gitConfigured ? "bg-green-500" : "bg-red-500"
                    )}
                  />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 relative"
                onClick={toggleNotifications}
                title={
                  notificationsEnabled && notificationsPermissionDenied
                    ? "Notifications blocked by browser \u2014 click to retry"
                    : notificationsEnabled
                    ? "Disable notifications"
                    : "Enable notifications"
                }
              >
                {notificationsEnabled ? (
                  <>
                    <BellRing className="h-3.5 w-3.5" />
                    {notificationsPermissionDenied && (
                      <AlertTriangle className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 text-yellow-500" />
                    )}
                  </>
                ) : (
                  <BellOff className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </Button>
              {onLogout && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={onLogout}
                  title="Sign out"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold tracking-tight">Claude Agents</h1>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 relative"
                onClick={() => setShowSettings((v) => !v)}
                title="Git settings"
              >
                <Settings className="h-4 w-4" />
                {gitConfigured !== null && (
                  <span
                    className={cn(
                      "absolute top-1 right-1 h-2 w-2 rounded-full",
                      gitConfigured ? "bg-green-500" : "bg-red-500"
                    )}
                  />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 relative"
                onClick={toggleNotifications}
                title={
                  notificationsEnabled && notificationsPermissionDenied
                    ? "Notifications blocked by browser \u2014 click to retry"
                    : notificationsEnabled
                    ? "Disable notifications"
                    : "Enable notifications"
                }
              >
                {notificationsEnabled ? (
                  <>
                    <BellRing className="h-4 w-4" />
                    {notificationsPermissionDenied && (
                      <AlertTriangle className="absolute -top-0.5 -right-0.5 h-3 w-3 text-yellow-500" />
                    )}
                  </>
                ) : (
                  <BellOff className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
      <Separator />
      <Dialog open={showSettings} onClose={() => setShowSettings(false)}>
        <GitSettingsPanel onClose={() => setShowSettings(false)} agents={agents} />
      </Dialog>
      <ScrollArea className="flex-1">
        <div className="p-2">
          <div className="flex items-center justify-between px-2 py-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Workspace
            </p>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              title="Refresh workspaces and git status"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            </button>
          </div>
          {projects.length === 0 && (
            <div className="flex flex-col items-center py-6 px-2 text-center">
              <FolderOpen className="h-10 w-10 text-muted-foreground/20 mb-2" />
              <p className="text-xs text-muted-foreground mb-1">No projects yet</p>
              <p className="text-[11px] text-muted-foreground/60">Create a project or clone a repo to get started</p>
            </div>
          )}
          {projects.map((project) => (
            <ProjectItem
              key={project.path}
              project={project}
              gitStatuses={gitStatuses}
              selectedId={selectedId}
              onSelect={onSelect}
              onCreate={onCreate}
              onDeleteProject={onDeleteProject}
              onAddWorktree={onAddWorktree}
              onRemoveWorktree={onRemoveWorktree}
              onRemoveWorktreeByPath={onRemoveWorktreeByPath}
              onDeleteAllLocalBranches={onDeleteAllLocalBranches}
              findAgentByWorkDir={findAgentByWorkDir}
            />
          ))}
        </div>

        {/* Agents not linked to any project or worktree.
            Gated on `projectsLoaded` to avoid a flash on page refresh:
            without it, agents can arrive before projects and every agent
            would momentarily be classified as "custom" (because
            allProjectPaths is still empty), causing the section to appear
            and then vanish once projects load. */}
        {projectsLoaded && agents.filter((a) => !allProjectPaths.has(a.workingDirectory)).length > 0 && (
          <>
            <Separator className="my-1" />
            <div className="p-2">
              <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Custom Agents
              </p>
              {agents
                .filter((a) => !allProjectPaths.has(a.workingDirectory))
                .map((agent) => (
                  <div
                    key={agent.id}
                    onClick={() => onSelect(agent.id)}
                    className={cn(
                      "w-full flex items-center gap-2 rounded-md px-2 py-2 text-sm text-left transition-colors cursor-pointer group",
                      selectedId === agent.id
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "hover:bg-sidebar-accent/50"
                    )}
                  >
                    <Circle
                      className={cn("h-2.5 w-2.5 shrink-0 fill-current", STATUS_COLORS[agent.status] || "text-muted-foreground")}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{agent.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{agent.workingDirectory}</div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete agent "${agent.name}"?`)) onDelete(agent.id);
                      }}
                      className="text-muted-foreground hover:text-destructive text-sm shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
            </div>
          </>
        )}
      </ScrollArea>
      <Separator />
      {onNavigate && (
        <div className="px-2 py-1.5">
          <button
            onClick={() => onNavigate("schedules")}
            className={cn(
              "w-full flex items-center gap-2 rounded-md px-2 py-2 text-sm text-left transition-colors",
              currentView === "schedules"
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "hover:bg-sidebar-accent/50"
            )}
          >
            <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span>Tasks</span>
            {scheduleCount > 0 && (
              <span className="ml-auto text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">{scheduleCount}</span>
            )}
          </button>
        </div>
      )}
      <Separator />
      <div className="p-3">
        {showForm ? (
          <NewAgentForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} />
        ) : (
          <div className="space-y-1.5">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setShowForm(true)}
            >
              <Plus className="h-4 w-4" />
              New Project
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setShowClone(true)}
            >
              <Download className="h-4 w-4" />
              Clone Repository
            </Button>
          </div>
        )}
        <CloneDialog
          open={showClone}
          onClose={() => setShowClone(false)}
          onClone={async (repoFullName, provider, accountId) => {
            const agent = await onClone(repoFullName, provider, accountId);
            setShowClone(false);
            onSelect(agent.id);
          }}
        />
      </div>
    </div>
  );
}
