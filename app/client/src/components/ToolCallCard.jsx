import { useState, useMemo } from "react";
import { FileText, FileEdit, FilePlus2, Terminal, FolderSearch, Search, Bot, Wrench, X, Clock, Cpu, Zap } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import Markdown from "./Markdown.jsx";

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
  const isTask = tool === "Task";

  // Parse subagent output into readable text and metadata
  const taskData = useMemo(() => {
    if (!isTask) return null;
    return parseTaskOutput(output);
  }, [isTask, output]);

  if (isTask) {
    return (
      <>
        {/* Subagent tile — visually distinct with accent border and color */}
        <div
          onClick={() => setDialogOpen(true)}
          className="bg-primary/5 border border-primary/25 rounded-lg px-3 py-2 text-xs cursor-pointer
                     hover:bg-primary/10 hover:border-primary/40 transition-colors flex items-center gap-2 min-w-0"
        >
          <Bot className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-primary font-semibold whitespace-nowrap">Subagent</span>
          <span className="text-muted-foreground truncate">{input?.description || input?.subagent_type || ""}</span>
          {taskData?.stats && (
            <span className="ml-auto text-muted-foreground/50 shrink-0 flex items-center gap-1">
              {taskData.stats.duration && <><Clock className="h-3 w-3" />{taskData.stats.duration}</>}
            </span>
          )}
        </div>

        {/* Large detail dialog for subagent */}
        <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} className="max-w-4xl">
          <div className="p-5 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm text-foreground">{input?.description || "Subagent"}</h3>
                  <p className="text-[11px] text-muted-foreground">
                    {input?.subagent_type && <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium mr-2">{input.subagent_type}</span>}
                    {input?.model && <span className="text-muted-foreground/60">{input.model}</span>}
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDialogOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Stats bar */}
            {taskData?.stats && (
              <div className="flex items-center gap-4 text-xs text-muted-foreground px-3 py-2 rounded-md bg-muted/30 border border-border">
                {taskData.stats.tokens && (
                  <span className="flex items-center gap-1"><Cpu className="h-3 w-3" />{taskData.stats.tokens} tokens</span>
                )}
                {taskData.stats.toolUses && (
                  <span className="flex items-center gap-1"><Zap className="h-3 w-3" />{taskData.stats.toolUses} tool uses</span>
                )}
                {taskData.stats.duration && (
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{taskData.stats.duration}</span>
                )}
              </div>
            )}

            {/* Prompt (collapsible) */}
            <TaskSection title="Prompt" defaultOpen={false}>
              <pre className="bg-background rounded-md p-3 text-foreground/70 whitespace-pre-wrap text-xs max-h-48 overflow-y-auto">
                {input?.prompt || ""}
              </pre>
            </TaskSection>

            {/* Response — rendered as markdown for readability */}
            {taskData?.text && (
              <TaskSection title="Response" defaultOpen={true}>
                <div className="bg-card rounded-md border border-border p-4 max-h-[60vh] overflow-y-auto text-sm">
                  <Markdown>{taskData.text}</Markdown>
                </div>
              </TaskSection>
            )}

            {/* Fallback: raw output if parsing failed */}
            {!taskData?.text && output && (
              <TaskSection title="Raw Output" defaultOpen={true}>
                <pre className="bg-background rounded-md p-3 text-green-400/70 whitespace-pre-wrap text-xs max-h-96 overflow-y-auto">
                  {output}
                </pre>
              </TaskSection>
            )}
          </div>
        </Dialog>
      </>
    );
  }

  // Regular tool card (unchanged)
  return (
    <>
      <div
        onClick={() => setDialogOpen(true)}
        className="bg-card border border-border rounded-lg px-3 py-2 text-xs cursor-pointer
                   hover:bg-accent transition-colors flex items-center gap-2 min-w-0"
      >
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-muted-foreground font-medium whitespace-nowrap">{label}</span>
        <span className="text-muted-foreground/50 truncate">{summary}</span>
      </div>

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

// Collapsible section for the subagent dialog
function TaskSection({ title, defaultOpen, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 hover:text-muted-foreground transition-colors mb-2"
      >
        <span className="text-[10px] transition-transform inline-block" style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>&#9654;</span>
        {title}
      </button>
      {open && children}
    </div>
  );
}

// Parse Task tool output — the SDK returns JSON array of text blocks + usage metadata
function parseTaskOutput(output) {
  if (!output) return null;

  let text = "";
  let stats = null;

  // Try parsing as JSON array of content blocks
  try {
    const blocks = JSON.parse(output);
    if (Array.isArray(blocks)) {
      const textParts = [];
      for (const block of blocks) {
        if (block.type === "text" && block.text) {
          // Check if this block contains usage metadata
          const usageMatch = block.text.match(/<usage>([\s\S]*?)<\/usage>/);
          if (usageMatch) {
            stats = parseUsageStats(usageMatch[1]);
            // Extract any text before the usage tag
            const before = block.text.replace(/agentId:.*\n?/g, "").replace(/<usage>[\s\S]*?<\/usage>/g, "").trim();
            if (before) textParts.push(before);
          } else {
            textParts.push(block.text);
          }
        }
      }
      text = textParts.join("\n\n");
    }
  } catch {
    // Not JSON — treat as plain text
    const usageMatch = output.match(/<usage>([\s\S]*?)<\/usage>/);
    if (usageMatch) {
      stats = parseUsageStats(usageMatch[1]);
      text = output.replace(/agentId:.*\n?/g, "").replace(/<usage>[\s\S]*?<\/usage>/g, "").trim();
    } else {
      text = output;
    }
  }

  return { text, stats };
}

function parseUsageStats(usageStr) {
  const stats = {};
  const tokensMatch = usageStr.match(/total_tokens:\s*(\d+)/);
  const toolUsesMatch = usageStr.match(/tool_uses:\s*(\d+)/);
  const durationMatch = usageStr.match(/duration_ms:\s*(\d+)/);

  if (tokensMatch) stats.tokens = Number(tokensMatch[1]).toLocaleString();
  if (toolUsesMatch) stats.toolUses = toolUsesMatch[1];
  if (durationMatch) {
    const ms = Number(durationMatch[1]);
    stats.duration = ms >= 60000 ? `${(ms / 60000).toFixed(1)}m` : `${(ms / 1000).toFixed(1)}s`;
  }
  return Object.keys(stats).length > 0 ? stats : null;
}

function getSummary(tool, input) {
  if (!input) return "";
  if (tool === "Read" || tool === "Write" || tool === "Edit") return input.file_path || input.path || "";
  if (tool === "Bash") return input.command?.slice(0, 60) || "";
  if (tool === "Glob") return input.pattern || "";
  if (tool === "Grep") return input.pattern || "";
  if (tool === "Task") return input.description || input.subagent_type || "";
  return "";
}
