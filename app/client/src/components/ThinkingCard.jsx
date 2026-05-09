import { useState } from "react";
import { Brain, ChevronRight } from "lucide-react";

/**
 * Collapsible card that displays the model's <thinking> scratchpad.
 * Collapsed by default — click to expand and read the reasoning.
 */
export default function ThinkingCard({ text }) {
  const [open, setOpen] = useState(false);

  if (!text) return null;

  // One-line preview (first meaningful line, truncated)
  const preview = text.split("\n").find((l) => l.trim())?.trim().slice(0, 120) || "Thinking...";

  return (
    <div className="max-w-full md:max-w-3/4">
      <button
        onClick={() => setOpen(!open)}
        className="w-full bg-muted/40 border border-border/60 rounded-lg px-3 py-2 text-xs
                   cursor-pointer hover:bg-muted/60 transition-colors flex items-center gap-2 min-w-0 text-left"
      >
        <Brain className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
        <span className="text-muted-foreground/60 font-medium whitespace-nowrap shrink-0">Thinking</span>
        {!open && (
          <span className="text-muted-foreground/40 truncate">{preview}</span>
        )}
        <ChevronRight
          className="h-3 w-3 text-muted-foreground/40 shrink-0 ml-auto transition-transform"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
        />
      </button>
      {open && (
        <div className="mt-1 border border-border/60 rounded-lg bg-muted/20 px-4 py-3 max-h-96 overflow-y-auto">
          <pre className="text-xs text-muted-foreground/70 whitespace-pre-wrap font-sans leading-relaxed">
            {text}
          </pre>
        </div>
      )}
    </div>
  );
}
