import { useState } from "react";
import NewAgentForm from "./NewAgentForm.jsx";

const STATUS_COLORS = {
  idle: "bg-green-500",
  busy: "bg-yellow-500",
  error: "bg-red-500",
};

export default function Sidebar({ agents, selectedId, onSelect, onCreate, onDelete }) {
  const [showForm, setShowForm] = useState(false);

  async function handleCreate(name, workingDirectory) {
    await onCreate(name, workingDirectory);
    setShowForm(false);
  }

  return (
    <div className="w-72 border-r border-gray-800 flex flex-col h-full">
      <div className="p-4 border-b border-gray-800">
        <h1 className="text-lg font-semibold mb-3">Claude Agents</h1>
        {showForm ? (
          <NewAgentForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} />
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium"
          >
            + New Agent
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {agents.map((agent) => (
          <div
            key={agent.id}
            onClick={() => onSelect(agent.id)}
            className={`flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-800 ${
              selectedId === agent.id ? "bg-gray-800" : ""
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_COLORS[agent.status] || "bg-gray-500"}`} />
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{agent.name}</div>
                <div className="text-xs text-gray-500 truncate">{agent.workingDirectory}</div>
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete agent "${agent.name}"?`)) onDelete(agent.id);
              }}
              className="text-gray-600 hover:text-red-400 text-sm shrink-0 ml-2"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
