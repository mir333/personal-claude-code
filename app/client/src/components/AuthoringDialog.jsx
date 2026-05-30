import { useState, useEffect } from "react";
import { Loader2, Sparkles, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// Extract the last fenced code block from assistant text.
function extractDraft(text) {
  const re = /```(?:json|yaml|text)?\s*\n([\s\S]*?)```/g;
  let last = null, m;
  while ((m = re.exec(text)) !== null) last = m[1];
  return last ? last.trim() : null;
}

export default function AuthoringDialog({ open, onClose, mode, currentDraft, onApply }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setMessages([]);
      setInput("");
    }
  }, [open]);

  async function send() {
    if (!input.trim() || busy) return;
    const next = [...messages, { role: "user", content: input.trim() }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const seeded = currentDraft
        ? [{ role: "user", content: `Current draft:\n\n${currentDraft}` }, ...next]
        : next;
      const r = await fetch("/api/tasks/author-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, messages: seeded }),
      });
      const data = await r.json();
      setMessages([...next, { role: "assistant", content: data.reply || data.error || "(no reply)" }]);
    } catch (err) {
      setMessages([...next, { role: "assistant", content: `Error: ${err.message}` }]);
    } finally {
      setBusy(false);
    }
  }

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const draft = lastAssistant ? extractDraft(lastAssistant.content) : null;

  return (
    <Dialog open={open} onClose={onClose} className="max-w-2xl w-full h-[80vh] overflow-hidden">
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border shrink-0">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Author {mode === "workflow" ? "Workflow" : "Prompt"} with AI</h3>
          <div className="flex-1" />
          <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={onClose}>Close</Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {messages.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Describe what you want. {mode === "workflow"
                ? "The assistant knows the workflow DSL and your available tasks."
                : "The assistant will draft an effective task prompt."}
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={cn("text-sm whitespace-pre-wrap rounded-md px-3 py-2",
              m.role === "user" ? "bg-muted" : "bg-primary/5 border border-primary/10")}>
              <span className="text-[10px] uppercase text-muted-foreground block mb-1">{m.role}</span>
              {m.content}
            </div>
          ))}
          {busy && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Thinking…</div>}
        </div>

        <div className="border-t border-border px-5 py-3 shrink-0 space-y-2">
          {draft && (
            <Button type="button" size="sm" className="w-full h-8 text-xs"
              onClick={() => { onApply(draft); onClose(); }}>
              <Check className="h-3 w-3 mr-1" /> Apply to editor
            </Button>
          )}
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }}
              placeholder="Describe the task or workflow… (Cmd/Ctrl+Enter to send)"
              className="flex-1 px-3 py-2 text-sm rounded-md border border-input bg-background resize-none h-16"
            />
            <Button type="button" onClick={send} disabled={busy || !input.trim()}>Send</Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
