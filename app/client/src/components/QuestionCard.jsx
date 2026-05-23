import { useState, useRef, useEffect } from "react";
import { CircleHelp, Check, CheckSquare, Square, Send, PenLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const OTHER_LABEL = "__other__";

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
  const [otherTexts, setOtherTexts] = useState(() => {
    const map = {};
    questions.forEach((_, i) => { map[i] = ""; });
    return map;
  });
  const [submitted, setSubmitted] = useState(false);

  function handleOptionClick(questionIndex, label, multiSelect) {
    if (!isInteractive || submitted) return;
    setSelections((prev) => {
      const next = { ...prev };
      const current = new Set(prev[questionIndex]);
      if (multiSelect) {
        if (label === OTHER_LABEL) {
          // Toggle "Other" in multi-select
          if (current.has(OTHER_LABEL)) current.delete(OTHER_LABEL);
          else current.add(OTHER_LABEL);
        } else {
          if (current.has(label)) current.delete(label);
          else current.add(label);
        }
      } else {
        current.clear();
        current.add(label);
      }
      next[questionIndex] = current;
      return next;
    });
  }

  function handleOtherTextChange(questionIndex, text) {
    setOtherTexts((prev) => ({ ...prev, [questionIndex]: text }));
  }

  function handleSubmit() {
    if (submitted) return;
    // Check that every question has at least one valid selection
    const allAnswered = questions.every((_, i) => {
      if (!selections[i] || selections[i].size === 0) return false;
      // If "Other" is the only selection, require text
      if (selections[i].has(OTHER_LABEL) && selections[i].size === 1) {
        return otherTexts[i]?.trim().length > 0;
      }
      // If "Other" is part of multi-select, require text for it
      if (selections[i].has(OTHER_LABEL)) {
        return otherTexts[i]?.trim().length > 0;
      }
      return true;
    });
    if (!allAnswered) return;

    setSubmitted(true);
    if (onAnswer) {
      const answers = {};
      questions.forEach((_, i) => {
        const parts = [...selections[i]]
          .map((label) => label === OTHER_LABEL ? otherTexts[i]?.trim() : label)
          .filter(Boolean);
        answers[String(i)] = parts.join(", ");
      });
      onAnswer({ answers });
    }
  }

  // For the submit button: check if all questions have a valid selection
  const allQuestionsAnswered = questions.every((_, i) => {
    if (!selections[i] || selections[i].size === 0) return false;
    if (selections[i].has(OTHER_LABEL)) {
      return otherTexts[i]?.trim().length > 0;
    }
    return true;
  });

  return (
    <div className="max-w-3/4 space-y-3 my-1">
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
          otherText={otherTexts[qi] || ""}
          onOptionClick={(label) => handleOptionClick(qi, label, q.multiSelect)}
          onOtherTextChange={(text) => handleOtherTextChange(qi, text)}
          onSubmit={handleSubmit}
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

function InteractiveQuestion({ question: q, questionIndex: qi, selectedLabels, answered, isInteractive, submitted, selected, otherText, onOptionClick, onOtherTextChange, onSubmit }) {
  // Determine which labels to highlight
  const highlightLabels = isInteractive ? selected : selectedLabels;
  const otherInputRef = useRef(null);
  const otherIsSelected = selected.has(OTHER_LABEL);

  // Auto-focus the "Other" text input when selected
  useEffect(() => {
    if (otherIsSelected && isInteractive && !submitted && otherInputRef.current) {
      otherInputRef.current.focus();
    }
  }, [otherIsSelected, isInteractive, submitted]);

  // Check if the answered result contains something that doesn't match any option label
  // (i.e. it was a free-text "Other" answer)
  const optionLabels = new Set((q.options || []).map((o) => o.label));
  const answeredOtherText = answered
    ? [...selectedLabels].find((l) => !optionLabels.has(l))
    : null;

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

        {/* "Other" free-text option */}
        {(() => {
          const clickable = isInteractive && !submitted;
          const isOtherHighlighted = isInteractive ? otherIsSelected : !!answeredOtherText;
          return (
            <div
              onClick={() => { if (clickable) onOptionClick(OTHER_LABEL); }}
              className={cn(
                "flex items-start gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                clickable && "cursor-pointer hover:bg-muted/50",
                isOtherHighlighted
                  ? "bg-primary/10 border border-primary/30"
                  : "bg-background border border-transparent"
              )}
            >
              <div className="mt-0.5 shrink-0">
                {(answered || submitted) ? (
                  isOtherHighlighted ? (
                    q.multiSelect
                      ? <CheckSquare className="h-4 w-4 text-primary" />
                      : <Check className="h-4 w-4 text-primary" />
                  ) : (
                    q.multiSelect
                      ? <Square className="h-4 w-4 text-muted-foreground/40" />
                      : <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />
                  )
                ) : clickable ? (
                  isOtherHighlighted ? (
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
                <div className={cn("font-medium flex items-center gap-1.5", isOtherHighlighted && "text-primary")}>
                  <PenLine className="h-3.5 w-3.5" />
                  Other
                </div>
                {/* Show text input when "Other" is selected and interactive */}
                {isInteractive && !submitted && otherIsSelected && (
                  <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      ref={otherInputRef}
                      type="text"
                      value={otherText}
                      onChange={(e) => onOtherTextChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && otherText.trim()) {
                          e.preventDefault();
                          onSubmit();
                        }
                      }}
                      placeholder="Type your answer..."
                      className="w-full px-2.5 py-1.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 placeholder:text-muted-foreground/50"
                    />
                  </div>
                )}
                {/* Show the answered "Other" text in read-only mode */}
                {(answered || submitted) && answeredOtherText && (
                  <div className="text-xs text-muted-foreground mt-0.5">{answeredOtherText}</div>
                )}
              </div>
            </div>
          );
        })()}
      </div>
      {(answered || submitted) && highlightLabels.size > 0 && (
        <div className="px-4 py-2 border-t border-border bg-muted/20 text-xs text-muted-foreground">
          Selected: {[...highlightLabels].join(", ")}
        </div>
      )}
    </div>
  );
}
