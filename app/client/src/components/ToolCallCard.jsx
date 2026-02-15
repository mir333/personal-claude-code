import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const TOOL_LABELS = {
  Read: "Read File",
  Write: "Write File",
  Edit: "Edit File",
  Bash: "Run Command",
  Glob: "Find Files",
  Grep: "Search Files",
  Task: "Subagent",
};

export default function ToolCallCard({ tool, input, output }) {
  const [open, setOpen] = useState(false);

  const label = TOOL_LABELS[tool] || tool;
  const summary = getSummary(tool, input);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="max-w-2xl bg-card border border-border rounded-lg text-xs my-1">
        <CollapsibleTrigger className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent rounded-lg transition-colors">
          <ChevronRight className={cn("h-3 w-3 text-muted-foreground transition-transform", open && "rotate-90")} />
          <span className="text-muted-foreground">{label}</span>
          <span className="text-muted-foreground/60 truncate">{summary}</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 pb-2 space-y-2">
            <pre className="bg-background rounded-md p-2 overflow-x-auto text-foreground/70 whitespace-pre-wrap text-xs">
              {typeof input === "string" ? input : JSON.stringify(input, null, 2)}
            </pre>
            {output && (
              <pre className="bg-background rounded-md p-2 overflow-x-auto text-green-400/70 whitespace-pre-wrap max-h-64 overflow-y-auto text-xs">
                {output}
              </pre>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
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
