import { useState } from "react";
import { AlertTriangle, X, Copy, CopyCheck } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * A clickable "card" that shows a short error summary inline and,
 * when clicked, opens a dialog with the full error details
 * (name, message, code, stack, extra details).
 */
export default function ErrorCard({ error }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!error) return null;

  const message = error.message || "Unknown error";
  const name = error.name || "Error";
  const code = error.code || null;
  const stack = error.stack || null;
  const details = error.details || null;
  const timestamp = error.timestamp || null;

  // One-line summary for the inline card (keeps the small card appearance)
  const summary = message.split("\n")[0];

  const fullText = [
    `${name}${code ? ` (${code})` : ""}: ${message}`,
    details ? `\nDetails:\n${Array.isArray(details) ? details.join("\n") : String(details)}` : "",
    stack ? `\nStack:\n${stack}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  async function handleCopy(e) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard not available — ignore silently
    }
  }

  return (
    <>
      {/* Inline card — clickable like ToolCallCard */}
      <div
        onClick={() => setDialogOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setDialogOpen(true);
          }
        }}
        className="max-w-full md:max-w-3/4 bg-destructive/20 text-destructive border border-destructive/30
                   rounded-lg px-4 py-2 text-sm cursor-pointer hover:bg-destructive/30
                   hover:border-destructive/50 transition-colors flex items-center gap-2 min-w-0"
        title="Click to see full error details"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="font-medium shrink-0">{name}</span>
        <span className="truncate text-destructive/80">{summary}</span>
      </div>

      {/* Large detail dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} className="max-w-3xl">
        <div className="p-5 space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-8 w-8 rounded-lg bg-destructive/10 border border-destructive/30 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-4 w-4 text-destructive" />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-sm text-foreground">
                  {name}
                  {code && (
                    <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                      ({code})
                    </span>
                  )}
                </h3>
                {timestamp && (
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(timestamp).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleCopy}
                title="Copy error details"
              >
                {copied ? (
                  <CopyCheck className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setDialogOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Message */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
              Message
            </p>
            <pre className="bg-background rounded-md p-3 text-destructive whitespace-pre-wrap text-xs border border-border max-h-48 overflow-y-auto">
              {message}
            </pre>
          </div>

          {/* Details (optional, e.g. array of errors) */}
          {details && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                Details
              </p>
              <pre className="bg-background rounded-md p-3 text-foreground/80 whitespace-pre-wrap text-xs border border-border max-h-48 overflow-y-auto">
                {Array.isArray(details) ? details.join("\n") : String(details)}
              </pre>
            </div>
          )}

          {/* Stack trace (optional) */}
          {stack && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                Stack trace
              </p>
              <pre className="bg-background rounded-md p-3 text-foreground/70 whitespace-pre text-[11px] border border-border max-h-96 overflow-auto font-mono">
                {stack}
              </pre>
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
}
