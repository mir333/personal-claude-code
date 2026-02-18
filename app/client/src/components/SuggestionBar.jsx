export default function SuggestionBar({ suggestions = [], options = [], actions = [], onSelect, onAction }) {
  if (suggestions.length === 0 && options.length === 0 && actions.length === 0) return null;

  return (
    <div className="px-4 pb-2 flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt.number}
          onClick={() => onSelect(opt.text)}
          className="border border-border bg-card hover:bg-accent text-sm rounded-lg px-3 py-2 text-left transition-colors cursor-pointer"
        >
          <span className="text-muted-foreground mr-1.5">{opt.number}.</span>
          {opt.text}
        </button>
      ))}
      {suggestions.map((s) => (
        <button
          key={s}
          onClick={() => onSelect(s)}
          className="bg-muted hover:bg-accent text-sm rounded-full px-3 py-1 transition-colors cursor-pointer"
        >
          {s}
        </button>
      ))}
      {actions.map((a) => (
        <button
          key={a.action}
          onClick={() => onAction(a.action)}
          className="bg-primary/15 hover:bg-primary/25 text-primary text-sm rounded-full px-3 py-1 transition-colors cursor-pointer border border-primary/30"
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
