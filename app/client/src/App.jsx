import { useEffect, useState, useCallback, useRef } from "react";
import { Send } from "lucide-react";
import Sidebar from "./components/Sidebar.jsx";
import ToolCallCard from "./components/ToolCallCard.jsx";
import Markdown from "./components/Markdown.jsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAgents } from "./hooks/useAgents.js";
import { useWebSocket } from "./hooks/useWebSocket.js";
import { useWorkspace } from "./hooks/useWorkspace.js";
import { useNotifications } from "./hooks/useNotifications.js";
import { useSessionStats } from "./hooks/useSessionStats.js";
import StatusBar from "./components/StatusBar.jsx";

export default function App() {
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const [conversations, setConversations] = useState({});
  const { agents, fetchAgents, createAgent, removeAgent, updateAgentStatus, findAgentByWorkDir } = useAgents();
  const { directories, fetchDirectories } = useWorkspace();
  const { enabled: notificationsEnabled, toggle: toggleNotifications, notify } = useNotifications();
  const { stats, recordUsage } = useSessionStats();
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
        recordUsage(rest);
        const agent = agents.find((a) => a.id === agentId);
        notify("Agent finished", { body: agent?.name || agentId });
      } else if (type === "error") {
        setConversations((prev) => {
          const conv = prev[agentId] || [];
          return { ...prev, [agentId]: [...conv, { type: "error", message: rest.message }] };
        });
        updateAgentStatus(agentId, "error");
        notify("Agent error", { body: rest.message });
      }
    },
    [updateAgentStatus, agents, notify, recordUsage]
  );

  const { send, connected } = useWebSocket(handleWsMessage);
  const selectedConversation = conversations[selectedAgentId] || [];

  useEffect(() => {
    fetchAgents();
    fetchDirectories();
  }, [fetchAgents, fetchDirectories]);

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

  return (
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar
        agents={agents}
        selectedId={selectedAgentId}
        onSelect={setSelectedAgentId}
        onCreate={createAgent}
        onDelete={handleDeleteAgent}
        directories={directories}
        findAgentByWorkDir={findAgentByWorkDir}
        notificationsEnabled={notificationsEnabled}
        toggleNotifications={toggleNotifications}
      />
      <div className="flex-1 flex flex-col">
        <StatusBar stats={stats} connected={connected} />
        {selectedAgentId ? (
          <>
            <ScrollArea className="flex-1 p-4">
              {selectedConversation.map((msg, i) => (
                <div key={i} className="mb-2 text-sm">
                  {msg.type === "user" && (
                    <div className="max-w-lg bg-primary text-primary-foreground rounded-lg px-4 py-2 w-fit ml-auto">
                      {msg.text}
                    </div>
                  )}
                  {msg.type === "assistant_stream" && (
                    <div className="max-w-2xl bg-card border border-border rounded-lg px-4 py-2">
                      <Markdown>{msg.text}</Markdown>
                    </div>
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
                    <div className="max-w-2xl bg-destructive/20 text-destructive rounded-lg px-4 py-2">
                      {msg.message}
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </ScrollArea>
            <ChatInput onSend={handleSend} connected={connected} />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            Select a project or create one to start chatting
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
    <form onSubmit={handleSubmit} className="p-4 border-t border-border">
      <div className="flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={connected ? "Send a message..." : "Connecting..."}
          disabled={!connected}
          className="flex-1"
        />
        <Button
          type="submit"
          disabled={!connected || !text.trim()}
          size="icon"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </form>
  );
}
