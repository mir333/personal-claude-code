import { useState, useEffect, useRef } from "react";
import { FolderOpen, Plus, Circle, BellRing, BellOff, GitBranch, Settings, Loader2, Download, ChevronDown, Search, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import NewAgentForm from "./NewAgentForm.jsx";
import GitHubClonePanel from "./GitHubClonePanel.jsx";
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

function GitStatus({ git, agentId, onBranchChange }) {
  if (!git || !git.isRepo) return null;
  const info = GIT_STATE[git.state] || GIT_STATE.clean;
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState([]);
  const [current, setCurrent] = useState("");
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function handleOpen(e) {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    setOpen(true);
    setFilter("");
    setError("");
    setLoading(true);
    fetch(`/api/agents/${agentId}/branches`)
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (ok) {
          setBranches(data.branches || []);
          setCurrent(data.current || "");
        } else {
          setError(data.error || "Failed to load branches");
        }
      })
      .catch(() => setError("Failed to load branches"))
      .finally(() => setLoading(false));
  }

  async function handleCheckout(branchName) {
    if (branchName === current) { setOpen(false); return; }
    setSwitching(branchName);
    setError("");
    try {
      const res = await fetch(`/api/agents/${agentId}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch: branchName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCurrent(data.branch);
      setOpen(false);
      if (onBranchChange) onBranchChange(agentId);
    } catch (err) {
      setError(err.message || "Failed to checkout");
    } finally {
      setSwitching(null);
    }
  }

  const filtered = branches.filter((b) =>
    b.name.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={handleOpen}
        className={cn("flex items-center gap-1 text-xs hover:underline", info.color)}
        title={`${info.label} — click to switch branch`}
      >
        <GitBranch className="h-3 w-3 shrink-0" />
        <span className="truncate">{git.branch}</span>
        {git.state === "dirty" && <span>*</span>}
        {git.state === "ahead" && git.unpushed > 0 && <span>{git.unpushed}↑</span>}
        <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-56 rounded-md border border-border bg-popover shadow-md">
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
            <div className="max-h-48 overflow-y-auto pb-1">
              {filtered.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-3">
                  {filter ? "No matching branches" : "No branches found"}
                </p>
              )}
              {filtered.map((b) => (
                <button
                  key={b.name}
                  onClick={(e) => { e.stopPropagation(); handleCheckout(b.name); }}
                  disabled={!!switching}
                  className={cn(
                    "w-full text-left px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors",
                    "hover:bg-accent disabled:opacity-50",
                    b.name === current && "font-semibold text-primary"
                  )}
                >
                  <span className="truncate flex-1">{b.name}</span>
                  {!b.local && <span className="text-muted-foreground/60 shrink-0">remote</span>}
                  {b.name === current && <span className="text-primary shrink-0">*</span>}
                  {switching === b.name && <Loader2 className="h-3 w-3 animate-spin shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GitSettingsPanel({ onClose }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [gitlabToken, setGitlabToken] = useState("");
  const [gitlabUrl, setGitlabUrl] = useState("https://gitlab.com");
  const [azuredevopsToken, setAzuredevopsToken] = useState("");
  const [azuredevopsOrg, setAzuredevopsOrg] = useState("");
  const [providers, setProviders] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/git-config")
      .then((r) => r.json())
      .then((data) => {
        setName(data.name || "");
        setEmail(data.email || "");
        const p = data.providers || {};
        setProviders(p);
        setGitlabUrl(p.gitlab?.url || "https://gitlab.com");
        setAzuredevopsOrg(p.azuredevops?.organization || "");
      })
      .catch(() => {});
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const body = { name, email };
      if (githubToken) body.githubToken = githubToken;
      if (gitlabToken) body.gitlabToken = gitlabToken;
      body.gitlabUrl = gitlabUrl;
      if (azuredevopsToken) body.azuredevopsToken = azuredevopsToken;
      body.azuredevopsOrg = azuredevopsOrg;

      const res = await fetch("/api/git-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setProviders(data.providers || {});
      setGithubToken("");
      setGitlabToken("");
      setAzuredevopsToken("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  const inputClass = "w-full mt-1 px-2 py-1.5 text-sm rounded-md border border-input bg-background";
  const hintClass = "text-[11px] text-muted-foreground/70 mt-1 leading-tight";
  const linkClass = "underline hover:text-foreground";

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Git Settings</h2>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-sm leading-none">✕</button>
      </div>
      <div className="space-y-2">
        <div>
          <label className="text-xs text-muted-foreground">User Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Your Name" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Email</label>
          <input type="text" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="you@example.com" />
        </div>

        <Separator className="my-2" />
        <p className="text-xs font-semibold text-muted-foreground">GitHub</p>
        <div>
          <label className="text-xs text-muted-foreground">Token (PAT)</label>
          <input type="password" value={githubToken} onChange={(e) => setGithubToken(e.target.value)} className={inputClass}
            placeholder={providers.github?.hasToken ? "Token configured ✓" : "Not set"} />
          <p className={hintClass}>
            Generate at{" "}
            <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" className={linkClass}>
              github.com/settings/tokens
            </a>
            . Select "Classic" token with <b>repo</b> scope.
          </p>
        </div>

        <Separator className="my-2" />
        <p className="text-xs font-semibold text-muted-foreground">GitLab</p>
        <div>
          <label className="text-xs text-muted-foreground">Token (PAT)</label>
          <input type="password" value={gitlabToken} onChange={(e) => setGitlabToken(e.target.value)} className={inputClass}
            placeholder={providers.gitlab?.hasToken ? "Token configured ✓" : "Not set"} />
          <p className={hintClass}>
            Generate at{" "}
            <a href="https://gitlab.com/-/user_settings/personal_access_tokens" target="_blank" rel="noopener noreferrer" className={linkClass}>
              GitLab &gt; Settings &gt; Access Tokens
            </a>
            . Select scopes: <b>api</b>, <b>read_repository</b>, <b>write_repository</b>.
          </p>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">URL</label>
          <input type="text" value={gitlabUrl} onChange={(e) => setGitlabUrl(e.target.value)} className={inputClass}
            placeholder="https://gitlab.com" />
          <p className={hintClass}>Change for self-hosted GitLab instances.</p>
        </div>

        <Separator className="my-2" />
        <p className="text-xs font-semibold text-muted-foreground">Azure DevOps</p>
        <div>
          <label className="text-xs text-muted-foreground">Token (PAT)</label>
          <input type="password" value={azuredevopsToken} onChange={(e) => setAzuredevopsToken(e.target.value)} className={inputClass}
            placeholder={providers.azuredevops?.hasToken ? "Token configured ✓" : "Not set"} />
          <p className={hintClass}>
            Generate at{" "}
            <a href="https://dev.azure.com" target="_blank" rel="noopener noreferrer" className={linkClass}>
              dev.azure.com
            </a>
            {" "}&gt; User Settings &gt; Personal Access Tokens. Select scope: <b>Code (Read &amp; Write)</b>.
          </p>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Organization</label>
          <input type="text" value={azuredevopsOrg} onChange={(e) => setAzuredevopsOrg(e.target.value)} className={inputClass}
            placeholder="my-org" />
          <p className={hintClass}>Your Azure DevOps organization name from the URL: dev.azure.com/<b>org-name</b></p>
        </div>

        <Button variant="outline" size="sm" className="w-full" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
          {saved ? "Saved!" : "Save"}
        </Button>
      </div>
    </div>
  );
}

export default function Sidebar({
  agents,
  selectedId,
  onSelect,
  onCreate,
  onClone,
  onDelete,
  onDeleteProject,
  onBranchChange,
  directories,
  findAgentByWorkDir,
  notificationsEnabled,
  toggleNotifications,
  gitStatuses = {},
  profile = null,
  onLogout,
}) {
  const [showForm, setShowForm] = useState(false);
  const [showClone, setShowClone] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [gitConfigured, setGitConfigured] = useState(null);

  useEffect(() => {
    fetch("/api/git-config")
      .then((r) => r.json())
      .then((data) => {
        const p = data.providers || {};
        const anyToken = p.github?.hasToken || p.gitlab?.hasToken || p.azuredevops?.hasToken || data.hasToken;
        setGitConfigured(!!data.name && !!data.email && anyToken);
      })
      .catch(() => {});
  }, [showSettings]);

  async function handleCreate(name, localOnly, provider) {
    await onCreate(name, localOnly, provider);
    setShowForm(false);
  }

  async function handleDirClick(dir) {
    const existing = findAgentByWorkDir(dir.path);
    if (existing) {
      onSelect(existing.id);
    } else {
      const agent = await onCreate(dir.name, dir.path);
      onSelect(agent.id);
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
                className="h-7 w-7"
                onClick={toggleNotifications}
                title={notificationsEnabled ? "Disable notifications" : "Enable notifications"}
              >
                {notificationsEnabled ? (
                  <BellRing className="h-3.5 w-3.5" />
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
                className="h-8 w-8 shrink-0"
                onClick={toggleNotifications}
                title={notificationsEnabled ? "Disable notifications" : "Enable notifications"}
              >
                {notificationsEnabled ? (
                  <BellRing className="h-4 w-4" />
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
        <GitSettingsPanel onClose={() => setShowSettings(false)} />
      </Dialog>
      <ScrollArea className="flex-1">
        <div className="p-2">
          <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Workspace
          </p>
          {directories.length === 0 && (
            <div className="flex flex-col items-center py-6 px-2 text-center">
              <FolderOpen className="h-10 w-10 text-muted-foreground/20 mb-2" />
              <p className="text-xs text-muted-foreground mb-1">No projects yet</p>
              <p className="text-[11px] text-muted-foreground/60">Create a project or clone a repo to get started</p>
            </div>
          )}
          {directories.map((dir) => {
            const agent = findAgentByWorkDir(dir.path);
            const isSelected = agent && agent.id === selectedId;
            return (
              <div
                key={dir.path}
                onClick={() => handleDirClick(dir)}
                className={cn(
                  "w-full flex items-center gap-2 rounded-md px-2 py-2 text-sm text-left transition-colors cursor-pointer group",
                  isSelected
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/50"
                )}
              >
                <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{dir.name}</div>
                  {agent && <GitStatus git={gitStatuses[agent.id]} agentId={agent.id} onBranchChange={onBranchChange} />}
                </div>
                {agent && (
                  <Circle
                    className={cn("h-2.5 w-2.5 shrink-0 fill-current", STATUS_COLORS[agent.status] || "text-muted-foreground")}
                  />
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete project "${dir.name}"? This will permanently remove the directory and all its files.`)) {
                      onDeleteProject(dir.name, agent?.id);
                    }
                  }}
                  className="text-muted-foreground hover:text-destructive text-sm shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>

        {/* Agents not linked to a workspace dir */}
        {agents.filter((a) => !directories.some((d) => d.path === a.workingDirectory)).length > 0 && (
          <>
            <Separator className="my-1" />
            <div className="p-2">
              <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Custom Agents
              </p>
              {agents
                .filter((a) => !directories.some((d) => d.path === a.workingDirectory))
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
                      <GitStatus git={gitStatuses[agent.id]} agentId={agent.id} onBranchChange={onBranchChange} />
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete agent "${agent.name}"?`)) onDelete(agent.id);
                      }}
                      className="text-muted-foreground hover:text-destructive text-sm shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ✕
                    </button>
                  </div>
                ))}
            </div>
          </>
        )}
      </ScrollArea>
      <Separator />
      <div className="p-3">
        {showForm ? (
          <NewAgentForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} />
        ) : showClone ? (
          <GitHubClonePanel
            onClone={async (repoFullName, provider) => {
              const agent = await onClone(repoFullName, provider);
              setShowClone(false);
              onSelect(agent.id);
            }}
            onCancel={() => setShowClone(false)}
          />
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
      </div>
    </div>
  );
}
