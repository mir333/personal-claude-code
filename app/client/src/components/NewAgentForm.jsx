import { useState } from "react";

function isValidWorkDir(dir) {
  const normalized = dir.replace(/\/+$/, "");
  return normalized.startsWith("/workspace/") && normalized.length > "/workspace/".length;
}

export default function NewAgentForm({ onSubmit, onCancel }) {
  const [name, setName] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState("/workspace/");
  const [error, setError] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    const dir = workingDirectory.trim();
    if (!name.trim()) return;
    if (!isValidWorkDir(dir)) {
      setError("Must be a subfolder of /workspace (e.g. /workspace/my-project)");
      return;
    }
    setError("");
    onSubmit(name.trim(), dir);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 p-3 bg-gray-800 rounded-lg">
      <input
        type="text"
        placeholder="Agent name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
        autoFocus
      />
      <input
        type="text"
        placeholder="Working directory"
        value={workingDirectory}
        onChange={(e) => setWorkingDirectory(e.target.value)}
        className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
      />
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          className="flex-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium"
        >
          Create
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
