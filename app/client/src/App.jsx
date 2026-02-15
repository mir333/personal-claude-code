import { useEffect, useState, useCallback, useRef } from "react";
import Sidebar from "./components/Sidebar.jsx";
import ToolCallCard from "./components/ToolCallCard.jsx";
import { useAgents } from "./hooks/useAgents.js";
import { useWebSocket } from "./hooks/useWebSocket.js";

export default function App() {
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const [conversations, setConversations] = useState({});
  const { agents, fetchAgents, createAgent, removeAgent, updateAgentStatus } = useAgents();
  const messagesEndRef = useRef(null);

  const handleWsMessage = useCallback(
    (msg) => {
      const { agentId, type, ...rest } = msg;
      if (!agentId) return;

      if (type === "text_delta") {
        setConversations((prev) => {
          const conv = prev[agentId] || [];
          const last = conv[conv.length - 1];
          if (last && last.type === "assistant_stream") {
            return { ...prev, [agentId]: [...conv.slice(0, -1), { ...last, text: last.text + rest.text }] };
          }
          return { ...prev, [agentId]: [...conv, { type: "assistant_stream", text: rest.text }] };
        });
        updateAgentStatus(agentId, "busy");
      } else if (type === "tool_call") {
        setConversations((prev) => {
          const conv = prev[agentId] || [];
          return { ...prev, [agentId]: [...conv, { type: "tool_call", tool: rest.tool, input: rest.input, toolUseId: rest.toolUseId }] };
        });
      } else if (type === "tool_result") {
        setConversations((prev) => {
          const conv = prev[agentId] || [];
          return { ...prev, [agentId]: [...conv, { type: "tool_result", toolUseId: rest.toolUseId, output: rest.output }] };
        });
      } else if (type === "done") {
        updateAgentStatus(agentId, "idle");
      } else if (type === "error") {
        setConversations((prev) => {
          const conv = prev[agentId] || [];
          return { ...prev, [agentId]: [...conv, { type: "error", message: rest.message }] };
        });
        updateAgentStatus(agentId, "error");
      }
    },
    [updateAgentStatus]
  );

  const { send, connected } = useWebSocket(handleWsMessage);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selectedConversation]);

  function handleSend(text) {
    if (!selectedAgentId || !text.trim()) return;
    setConversations((prev) => ({
      ...prev,
      [selectedAgentId]: [...(prev[selectedAgentId] || []), { type: "user", text }],
    }));
    send({ type: "message", agentId: selectedAgentId, text });
  }

  async function handleDeleteAgent(id) {
    await removeAgent(id);
    if (selectedAgentId === id) setSelectedAgentId(null);
    setConversations((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  const selectedConversation = conversations[selectedAgentId] || [];

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      <Sidebar
        agents={agents}
        selectedId={selectedAgentId}
        onSelect={setSelectedAgentId}
        onCreate={createAgent}
        onDelete={handleDeleteAgent}
      />
      <div className="flex-1 flex flex-col">
        {selectedAgentId ? (
          <>
            {!connected && (
              <div className="px-4 py-1.5 bg-yellow-900/50 text-yellow-300 text-xs text-center">
                Reconnecting to server...
              </div>
            )}
            <div className="flex-1 overflow-y-auto p-4">
              {selectedConversation.map((msg, i) => (
                <div key={i} className="mb-2 text-sm">
                  {msg.type === "user" && (
                    <div className="max-w-lg bg-blue-600 rounded-lg px-4 py-2 w-fit ml-auto">{msg.text}</div>
                  )}
                  {msg.type === "assistant_stream" && (
                    <div className="max-w-2xl bg-gray-800 rounded-lg px-4 py-2 whitespace-pre-wrap">{msg.text}</div>
                  )}
                  {msg.type === "tool_call" && (
                    <ToolCallCard
                      tool={msg.tool}
                      input={msg.input}
                      output={selectedConversation.find(
                        (m) => m.type === "tool_result" && m.toolUseId === msg.toolUseId
                      )?.output}
                    />
                  )}
                  {msg.type === "tool_result" && null}
                  {msg.type === "error" && (
                    <div className="max-w-2xl bg-red-900/50 text-red-300 rounded-lg px-4 py-2">{msg.message}</div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <ChatInput onSend={handleSend} connected={connected} />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-600">
            Select or create an agent to start chatting
          </div>
        )}
      </div>
    </div>
  );
}

function ChatInput({ onSend, connected }) {
  const [text, setText] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    if (text.trim()) {
      onSend(text);
      setText("");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="p-4 border-t border-gray-800">
      <div className="flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={connected ? "Send a message..." : "Connecting..."}
          disabled={!connected}
          className="flex-1 px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!connected || !text.trim()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 rounded-lg text-sm font-medium"
        >
          Send
        </button>
      </div>
    </form>
  );
}
