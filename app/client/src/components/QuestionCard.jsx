import { useState } from "react";
import { CircleHelp, Check, CheckSquare, Square, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

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

export default function QuestionCard({ input, output, interactive, onAnswer }) {
  const questions = input?.questions;
  if (!questions || !Array.isArray(questions) || questions.length === 0) return null;

  const selectedLabels = getSelectedLabels(output);
  const answered = output != null;
  const isInteractive = interactive && !answered;

  return (
    <div className="max-w-2xl space-y-3 my-1">
      {questions.map((q, qi) => (
        <InteractiveQuestion
          key={qi}
          question={q}
          questionIndex={qi}
          selectedLabels={selectedLabels}
          answered={answered}
          isInteractive={isInteractive}
          onAnswer={onAnswer}
          totalQuestions={questions.length}
        />
      ))}
    </div>
  );
}

function InteractiveQuestion({ question: q, questionIndex: qi, selectedLabels, answered, isInteractive, onAnswer, totalQuestions }) {
  const [selected, setSelected] = useState(new Set());
  const [submitted, setSubmitted] = useState(false);

  function handleOptionClick(label) {
    if (!isInteractive || submitted) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (q.multiSelect) {
        if (next.has(label)) next.delete(label);
        else next.add(label);
      } else {
        next.clear();
        next.add(label);
      }
      return next;
    });
  }

  function handleSubmit() {
    if (selected.size === 0 || submitted) return;
    setSubmitted(true);
    if (onAnswer) {
      const answers = {};
      // For single-question cards, use simple answer format
      if (totalQuestions === 1) {
        answers["0"] = [...selected].join(", ");
      } else {
        answers[String(qi)] = [...selected].join(", ");
      }
      onAnswer({ answers });
    }
  }

  // Determine which labels to highlight
  const highlightLabels = isInteractive ? selected : selectedLabels;

  return (
    <div className={cn(
      "bg-card border rounded-lg overflow-hidden",
      isInteractive && !submitted ? "border-primary/50 ring-1 ring-primary/20" : "border-border"
    )}>
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
          const isSelected = highlightLabels.has(opt.label);
          const clickable = isInteractive && !submitted;
          return (
            <div
              key={oi}
              onClick={() => handleOptionClick(opt.label)}
              className={cn(
                "flex items-start gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                clickable && "cursor-pointer hover:bg-muted/50",
                isSelected
                  ? "bg-primary/10 border border-primary/30"
                  : "bg-background border border-transparent"
              )}
            >
              <div className="mt-0.5 shrink-0">
                {(answered || submitted) ? (
                  isSelected ? (
                    q.multiSelect
                      ? <CheckSquare className="h-4 w-4 text-primary" />
                      : <Check className="h-4 w-4 text-primary" />
                  ) : (
                    q.multiSelect
                      ? <Square className="h-4 w-4 text-muted-foreground/40" />
                      : <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />
                  )
                ) : clickable ? (
                  isSelected ? (
                    q.multiSelect
                      ? <CheckSquare className="h-4 w-4 text-primary" />
                      : <div className="h-4 w-4 rounded-full border-[5px] border-primary" />
                  ) : (
                    q.multiSelect
                      ? <Square className="h-4 w-4 text-muted-foreground/50" />
                      : <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/40" />
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
      {isInteractive && !submitted && (
        <div className="px-4 py-2.5 border-t border-border bg-muted/20 flex justify-end">
          <Button
            size="sm"
            disabled={selected.size === 0}
            onClick={handleSubmit}
            className="gap-1.5"
          >
            <Send className="h-3.5 w-3.5" />
            Submit
          </Button>
        </div>
      )}
      {(answered || submitted) && highlightLabels.size > 0 && (
        <div className="px-4 py-2 border-t border-border bg-muted/20 text-xs text-muted-foreground">
          Selected: {[...highlightLabels].join(", ")}
        </div>
      )}
    </div>
  );
}
