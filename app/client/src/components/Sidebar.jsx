import { useState, useEffect } from "react";
import { FolderOpen, Plus, Circle, BellRing, BellOff, GitBranch, Settings, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import NewAgentForm from "./NewAgentForm.jsx";
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

function GitStatus({ git }) {
  if (!git || !git.isRepo) return null;
  const info = GIT_STATE[git.state] || GIT_STATE.clean;
  return (
    <div className={cn("flex items-center gap-1 text-xs", info.color)} title={info.label}>
      <GitBranch className="h-3 w-3 shrink-0" />
      <span className="truncate">{git.branch}</span>
      {git.state === "dirty" && <span>*</span>}
      {git.state === "ahead" && git.unpushed > 0 && <span>{git.unpushed}↑</span>}
    </div>
  );
}

function GitSettingsPanel({ onClose }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/git-config")
      .then((r) => r.json())
      .then((data) => {
        setName(data.name || "");
        setEmail(data.email || "");
        setHasToken(data.hasToken);
      })
      .catch(() => {});
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/git-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, ...(token ? { token } : {}) }),
      });
      const data = await res.json();
      setHasToken(data.hasToken);
      setToken("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Git Settings</p>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-sm">✕</button>
      </div>
      <div className="space-y-2">
        <div>
          <label className="text-xs text-muted-foreground">User Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full mt-1 px-2 py-1.5 text-sm rounded-md border border-input bg-background"
            placeholder="Your Name"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Email</label>
          <input
            type="text"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full mt-1 px-2 py-1.5 text-sm rounded-md border border-input bg-background"
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">GitHub Token</label>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="w-full mt-1 px-2 py-1.5 text-sm rounded-md border border-input bg-background"
            placeholder={hasToken ? "Token configured ✓" : "Not set"}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={handleSave}
          disabled={saving}
        >
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
  onDelete,
  directories,
  findAgentByWorkDir,
  notificationsEnabled,
  toggleNotifications,
  gitStatuses = {},
}) {
  const [showForm, setShowForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [gitConfigured, setGitConfigured] = useState(null);

  useEffect(() => {
    fetch("/api/git-config")
      .then((r) => r.json())
      .then((data) => setGitConfigured(!!data.name && !!data.email && data.hasToken))
      .catch(() => {});
  }, [showSettings]);

  async function handleCreate(name, workingDirectory) {
    await onCreate(name, workingDirectory);
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
      <div className="p-4 pb-3 flex items-center justify-between">
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
      <Separator />
      <ScrollArea className="flex-1">
        {showSettings && (
          <>
            <GitSettingsPanel onClose={() => setShowSettings(false)} />
            <Separator />
          </>
        )}
        <div className="p-2">
          <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Workspace
          </p>
          {directories.length === 0 && (
            <p className="px-2 py-3 text-xs text-muted-foreground">No projects found</p>
          )}
          {directories.map((dir) => {
            const agent = findAgentByWorkDir(dir.path);
            const isSelected = agent && agent.id === selectedId;
            return (
              <button
                key={dir.path}
                onClick={() => handleDirClick(dir)}
                className={cn(
                  "w-full flex items-center gap-2 rounded-md px-2 py-2 text-sm text-left transition-colors cursor-pointer",
                  isSelected
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/50"
                )}
              >
                <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{dir.name}</div>
                  {agent && <GitStatus git={gitStatuses[agent.id]} />}
                </div>
                {agent && (
                  <Circle
                    className={cn("h-2.5 w-2.5 shrink-0 fill-current", STATUS_COLORS[agent.status] || "text-muted-foreground")}
                  />
                )}
              </button>
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
                      <GitStatus git={gitStatuses[agent.id]} />
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
        ) : (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setShowForm(true)}
          >
            <Plus className="h-4 w-4" />
            New Project
          </Button>
        )}
      </div>
    </div>
  );
}
