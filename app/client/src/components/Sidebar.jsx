import { useState } from "react";
import { FolderOpen, Plus, Circle, BellRing, BellOff } from "lucide-react";
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
}) {
  const [showForm, setShowForm] = useState(false);

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
      <Separator />
      <ScrollArea className="flex-1">
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
                <span className="truncate flex-1">{dir.name}</span>
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
