import { Settings } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Responsive suggestion bar with configurable suggestion objects.
 *
 * Suggestions are shown based on screen size (CSS-only):
 *  - Items 0-2:  always visible (all screens)
 *  - Items 3-5:  hidden on small, visible on md+ (768px+)
 *  - Items 6-9:  visible on lg+ (1024px+)
 *  - Items 10+:  visible on xl+ (1280px+)
 */
function getResponsiveClass(index) {
  if (index < 3) return "";
  if (index < 6) return "hidden md:inline-flex";
  if (index < 10) return "md:hidden lg:inline-flex";
  return "lg:hidden xl:inline-flex";
}

export default function SuggestionBar({
  suggestions = [],
  actions = [],
  onSelect,
  onAction,
  onManage,
}) {
  if (suggestions.length === 0 && actions.length === 0) return null;

  return (
    <div className="px-4 pb-2 flex flex-wrap gap-2 items-center">
      {suggestions.map((s, i) => (
        <button
          key={s.id}
          onClick={() => onSelect(s)}
          title={s.description}
          className={cn(
            "bg-muted hover:bg-accent text-sm rounded-full px-3 py-1 transition-colors cursor-pointer",
            getResponsiveClass(i)
          )}
        >
          {s.displayName}
        </button>
      ))}
      {actions.map((a) => (
        <button
          key={a.id}
          onClick={() => onAction(a)}
          title={a.description}
          className="bg-primary/15 hover:bg-primary/25 text-primary text-sm rounded-full px-3 py-1 transition-colors cursor-pointer border border-primary/30"
        >
          {a.displayName}
        </button>
      ))}
      {onManage && (
        <button
          onClick={onManage}
          title="Manage suggestions"
          className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md ml-auto"
        >
          <Settings className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
