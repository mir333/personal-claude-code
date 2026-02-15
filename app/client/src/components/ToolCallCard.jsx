import { useState } from "react";

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
  const [expanded, setExpanded] = useState(false);

  const label = TOOL_LABELS[tool] || tool;
  const summary = getSummary(tool, input);

  return (
    <div className="max-w-2xl bg-gray-900 border border-gray-800 rounded-lg text-xs my-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-800 rounded-lg"
      >
        <span className={`transition-transform ${expanded ? "rotate-90" : ""}`}>▶</span>
        <span className="text-gray-400">{label}</span>
        <span className="text-gray-500 truncate">{summary}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 space-y-2">
          <pre className="bg-gray-950 rounded p-2 overflow-x-auto text-gray-300 whitespace-pre-wrap">
            {typeof input === "string" ? input : JSON.stringify(input, null, 2)}
          </pre>
          {output && (
            <pre className="bg-gray-950 rounded p-2 overflow-x-auto text-green-400/70 whitespace-pre-wrap max-h-64 overflow-y-auto">
              {output}
            </pre>
          )}
        </div>
      )}
    </div>
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
