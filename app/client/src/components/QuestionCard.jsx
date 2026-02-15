import { useState } from "react";
import { CircleHelp, Check, CheckSquare, Square } from "lucide-react";
import { cn } from "@/lib/utils";

function parseResult(output) {
  if (!output) return null;
  try {
    const parsed = JSON.parse(output);
    // The tool result can be { answers: { "0": "label", ... } } or a plain string
    if (parsed.answers) return parsed.answers;
    return parsed;
  } catch {
    return output;
  }
}

function getSelectedLabels(output) {
  const result = parseResult(output);
  if (!result) return new Set();
  if (typeof result === "string") return new Set([result]);
  if (typeof result === "object") return new Set(Object.values(result));
  return new Set();
}

export default function QuestionCard({ input, output }) {
  const questions = input?.questions;
  if (!questions || !Array.isArray(questions) || questions.length === 0) return null;

  const selectedLabels = getSelectedLabels(output);
  const answered = output != null;

  return (
    <div className="max-w-2xl space-y-3 my-1">
      {questions.map((q, qi) => (
        <div key={qi} className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/30">
            <CircleHelp className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm font-medium">{q.question}</span>
            {q.header && (
              <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                {q.header}
              </span>
            )}
          </div>
          <div className="p-2 space-y-1">
            {(q.options || []).map((opt, oi) => {
              const isSelected = selectedLabels.has(opt.label);
              return (
                <div
                  key={oi}
                  className={cn(
                    "flex items-start gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                    isSelected
                      ? "bg-primary/10 border border-primary/30"
                      : "bg-background border border-transparent"
                  )}
                >
                  <div className="mt-0.5 shrink-0">
                    {answered ? (
                      isSelected ? (
                        q.multiSelect
                          ? <CheckSquare className="h-4 w-4 text-primary" />
                          : <Check className="h-4 w-4 text-primary" />
                      ) : (
                        q.multiSelect
                          ? <Square className="h-4 w-4 text-muted-foreground/40" />
                          : <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />
                      )
                    ) : (
                      q.multiSelect
                        ? <Square className="h-4 w-4 text-muted-foreground/50" />
                        : <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/40" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={cn("font-medium", isSelected && "text-primary")}>
                      {opt.label}
                    </div>
                    {opt.description && (
                      <div className="text-xs text-muted-foreground mt-0.5">{opt.description}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {answered && selectedLabels.size > 0 && (
            <div className="px-4 py-2 border-t border-border bg-muted/20 text-xs text-muted-foreground">
              Selected: {[...selectedLabels].join(", ")}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
