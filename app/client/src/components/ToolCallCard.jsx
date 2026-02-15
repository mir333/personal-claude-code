export default function ToolCallCard({ tool, input, output }) {
  return (
    <div className="max-w-2xl text-xs text-gray-400 bg-gray-900 rounded px-3 py-1.5">
      Tool: {tool}
    </div>
  );
}
