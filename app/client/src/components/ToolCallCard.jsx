import { useState } from "react";
import { FileText, FileEdit, FilePlus2, Terminal, FolderSearch, Search, Bot, Wrench, X } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const TOOL_LABELS = {
  Read: "Read File",
  Write: "Write File",
  Edit: "Edit File",
  Bash: "Run Command",
  Glob: "Find Files",
  Grep: "Search Files",
  Task: "Subagent",
};

const TOOL_ICONS = {
  Read: FileText,
  Write: FilePlus2,
  Edit: FileEdit,
  Bash: Terminal,
  Glob: FolderSearch,
  Grep: Search,
  Task: Bot,
};

export default function ToolCallCard({ tool, input, output }) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const label = TOOL_LABELS[tool] || tool;
  const summary = getSummary(tool, input);
  const Icon = TOOL_ICONS[tool] || Wrench;

  return (
    <>
      {/* Compact grid tile */}
      <div
        onClick={() => setDialogOpen(true)}
        className="bg-card border border-border rounded-lg px-3 py-2 text-xs cursor-pointer
                   hover:bg-accent transition-colors flex items-center gap-2 min-w-0"
      >
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-muted-foreground font-medium whitespace-nowrap">{label}</span>
        <span className="text-muted-foreground/50 truncate">{summary}</span>
      </div>

      {/* Detail dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} className="max-w-2xl">
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-medium text-sm">{label}</h3>
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setDialogOpen(false)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          {summary && (
            <p className="text-xs text-muted-foreground truncate">{summary}</p>
          )}
          <div className="space-y-2">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">Input</p>
            <pre className="bg-background rounded-md p-3 overflow-x-auto text-foreground/70 whitespace-pre-wrap text-xs max-h-64 overflow-y-auto">
              {typeof input === "string" ? input : JSON.stringify(input, null, 2)}
            </pre>
          </div>
          {output && (
            <div className="space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">Output</p>
              <pre className="bg-background rounded-md p-3 overflow-x-auto text-green-400/70 whitespace-pre-wrap max-h-96 overflow-y-auto text-xs">
                {output}
              </pre>
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
}

function getSummary(tool, input) {
  if (!input) return "";
  if (tool === "Read" || tool === "Write" || tool === "Edit") return input.file_path || input.path || "";
  if (tool === "Bash") return input.command?.slice(0, 60) || "";
  if (tool === "Glob") return input.pattern || "";
  if (tool === "Grep") return input.pattern || "";
  return "";
}
