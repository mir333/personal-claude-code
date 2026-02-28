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

  // Lift selection state for all questions to the parent
  const [selections, setSelections] = useState(() => {
    const map = {};
    questions.forEach((_, i) => { map[i] = new Set(); });
    return map;
  });
  const [submitted, setSubmitted] = useState(false);

  function handleOptionClick(questionIndex, label, multiSelect) {
    if (!isInteractive || submitted) return;
    setSelections((prev) => {
      const next = { ...prev };
      const current = new Set(prev[questionIndex]);
      if (multiSelect) {
        if (current.has(label)) current.delete(label);
        else current.add(label);
      } else {
        current.clear();
        current.add(label);
      }
      next[questionIndex] = current;
      return next;
    });
  }

  function handleSubmit() {
    if (submitted) return;
    // Check that every question has at least one selection
    const allAnswered = questions.every((_, i) => selections[i] && selections[i].size > 0);
    if (!allAnswered) return;

    setSubmitted(true);
    if (onAnswer) {
      const answers = {};
      questions.forEach((_, i) => {
        answers[String(i)] = [...selections[i]].join(", ");
      });
      onAnswer({ answers });
    }
  }

  // For the submit button: check if all questions have a selection
  const allQuestionsAnswered = questions.every((_, i) => selections[i] && selections[i].size > 0);

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
          submitted={submitted}
          selected={selections[qi] || new Set()}
          onOptionClick={(label) => handleOptionClick(qi, label, q.multiSelect)}
        />
      ))}
      {isInteractive && !submitted && (
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={!allQuestionsAnswered}
            onClick={handleSubmit}
            className="gap-1.5"
          >
            <Send className="h-3.5 w-3.5" />
            Submit{questions.length > 1 ? ` All (${questions.length})` : ""}
          </Button>
        </div>
      )}
    </div>
  );
}

function InteractiveQuestion({ question: q, questionIndex: qi, selectedLabels, answered, isInteractive, submitted, selected, onOptionClick }) {
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
              onClick={() => onOptionClick(opt.label)}
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
      {(answered || submitted) && highlightLabels.size > 0 && (
        <div className="px-4 py-2 border-t border-border bg-muted/20 text-xs text-muted-foreground">
          Selected: {[...highlightLabels].join(", ")}
        </div>
      )}
    </div>
  );
}
