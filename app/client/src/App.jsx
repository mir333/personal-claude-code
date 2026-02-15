import { useEffect, useState, useCallback, useRef } from "react";
import { Send, Trash2, Menu } from "lucide-react";
import Sidebar from "./components/Sidebar.jsx";
import ToolCallCard from "./components/ToolCallCard.jsx";
import Markdown from "./components/Markdown.jsx";
import LoginScreen from "./components/LoginScreen.jsx";
import SuggestionBar from "./components/SuggestionBar.jsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useAgents } from "./hooks/useAgents.js";
import { useWebSocket } from "./hooks/useWebSocket.js";
import { useWorkspace } from "./hooks/useWorkspace.js";
import { useNotifications } from "./hooks/useNotifications.js";
import { useUsageStats } from "./hooks/useUsageStats.js";
import StatusBar from "./components/StatusBar.jsx";

export default function App() {
  const [authenticated, setAuthenticated] = useState(null); // null = loading
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const [conversations, setConversations] = useState({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { agents, fetchAgents, createAgent, removeAgent, updateAgentStatus, findAgentByWorkDir } = useAgents();
  const { directories, fetchDirectories } = useWorkspace();
  const { enabled: notificationsEnabled, toggle: toggleNotifications, notify } = useNotifications();
  const { usage, refresh: refreshUsage } = useUsageStats();
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
        setConversations((prev) => {
          const conv = prev[agentId] || [];
          return {
            ...prev,
            [agentId]: [...conv, {
              type: "stats",
              cost: rest.cost,
              usage: rest.usage,
              modelUsage: rest.modelUsage,
              numTurns: rest.numTurns,
              durationMs: rest.durationMs,
            }],
          };
        });
        updateAgentStatus(agentId, "idle");
        refreshUsage();
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
    [updateAgentStatus, agents, notify, refreshUsage]
  );

  const { send, connected } = useWebSocket(handleWsMessage);
  const selectedConversation = conversations[selectedAgentId] || [];

  // Derive context window info from the last stats entry after the most recent context_cleared
  const contextInfo = (() => {
    const conv = selectedConversation;
    let lastClearIdx = -1;
    for (let i = conv.length - 1; i >= 0; i--) {
      if (conv[i].type === "context_cleared") { lastClearIdx = i; break; }
    }
    for (let i = conv.length - 1; i > lastClearIdx; i--) {
      if (conv[i].type === "stats" && conv[i].usage) {
        const u = conv[i].usage;
        if (u.contextWindow) {
          return { contextWindow: u.contextWindow, used: (u.input_tokens || 0) + (u.output_tokens || 0) };
        }
      }
    }
    return null;
  })();

  // Parse numbered options from last assistant message and compute contextual suggestions
  const { suggestions, options } = (() => {
    const agent = agents.find((a) => a.id === selectedAgentId);
    if (!agent || agent.status === "busy") return { suggestions: [], options: [] };

    const conv = selectedConversation;
    if (conv.length === 0) return { suggestions: [], options: [] };

    const lastEntry = conv[conv.length - 1];

    // Parse numbered options from the last assistant_stream text before a stats/done entry
    let parsedOptions = [];
    if (lastEntry.type === "stats") {
      // Find the last assistant_stream before this stats entry
      for (let i = conv.length - 2; i >= 0; i--) {
        if (conv[i].type === "assistant_stream") {
          const lines = conv[i].text.split("\n");
          const optionRe = /^\s*(\d+)[.)]\s+\*{0,2}(.+?)\*{0,2}\s*$/;
          const candidates = [];
          for (const line of lines) {
            const m = line.match(optionRe);
            if (m) {
              candidates.push({ number: parseInt(m[1], 10), text: m[2] });
            } else if (candidates.length > 0) {
              // Break on non-matching line after we started collecting
              break;
            }
          }
          // Only use if 2+ consecutive numbered items were found
          if (candidates.length >= 2) parsedOptions = candidates;
          break;
        }
        // Skip tool_call/tool_result entries
        if (conv[i].type !== "tool_call" && conv[i].type !== "tool_result") break;
      }
    }

    // Compute contextual suggestions
    let sugg = [];
    if (lastEntry.type === "stats") {
      sugg = ["Continue", "Summarize changes", "Commit changes", "Push code"];
    } else if (lastEntry.type === "error") {
      sugg = ["Try again", "Explain the error"];
    } else if (lastEntry.type === "context_cleared") {
      sugg = ["Start fresh"];
    } else {
      return { suggestions: [], options: [] };
    }

    // Check if recent entries include Bash tool calls
    const recentSlice = conv.slice(-20);
    if (recentSlice.some((m) => m.type === "tool_call" && m.tool === "Bash")) {
      if (!sugg.includes("Run tests")) sugg.push("Run tests");
    }

    return { suggestions: sugg, options: parsedOptions };
  })();

  useEffect(() => {
    fetch("/api/auth/check")
      .then((r) => r.json())
      .then((data) => setAuthenticated(data.authenticated))
      .catch(() => setAuthenticated(false));
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    fetchAgents();
    fetchDirectories();
  }, [authenticated, fetchAgents, fetchDirectories]);

  useEffect(() => {
    if (!selectedAgentId) return;
    // Only load if no entries exist yet (avoid overwriting active session)
    if (conversations[selectedAgentId]?.length) return;
    fetch(`/api/agents/${selectedAgentId}/history`)
      .then((r) => r.ok ? r.json() : [])
      .then((entries) => {
        if (entries.length > 0) {
          setConversations((prev) => {
            if (prev[selectedAgentId]?.length) return prev;
            return { ...prev, [selectedAgentId]: entries };
          });
        }
      })
      .catch(() => {});
  }, [selectedAgentId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selectedConversation]);

  function handleSelectAgent(id) {
    setSelectedAgentId(id);
    setSidebarOpen(false);
  }

  function handleSend(text) {
    if (!selectedAgentId || !text.trim()) return;
    setConversations((prev) => ({
      ...prev,
      [selectedAgentId]: [...(prev[selectedAgentId] || []), { type: "user", text }],
    }));
    send({ type: "message", agentId: selectedAgentId, text });
  }

  async function handleClearContext() {
    if (!selectedAgentId) return;
    try {
      const res = await fetch(`/api/agents/${selectedAgentId}/clear-context`, { method: "POST" });
      if (res.ok) {
        setConversations((prev) => ({
          ...prev,
          [selectedAgentId]: [
            ...(prev[selectedAgentId] || []),
            { type: "context_cleared", timestamp: Date.now() },
          ],
        }));
      }
    } catch {}
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

  if (authenticated === null) {
    return <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">Loading...</div>;
  }

  if (!authenticated) {
    return <LoginScreen onSuccess={() => setAuthenticated(true)} />;
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar: always visible on md+, slide-over on mobile */}
      <div className={cn(
        "fixed inset-y-0 left-0 z-40 transition-transform duration-200 md:static md:translate-x-0",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <Sidebar
          agents={agents}
          selectedId={selectedAgentId}
          onSelect={handleSelectAgent}
          onCreate={createAgent}
          onDelete={handleDeleteAgent}
          directories={directories}
          findAgentByWorkDir={findAgentByWorkDir}
          notificationsEnabled={notificationsEnabled}
          toggleNotifications={toggleNotifications}
        />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center border-b border-border bg-card">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden shrink-0 ml-2"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <StatusBar usage={usage} connected={connected} contextInfo={contextInfo} className="flex-1 border-b-0" />
        </div>
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
                  {msg.type === "stats" && (
                    <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground py-1.5 px-2">
                      {msg.cost != null && <span>${msg.cost < 0.01 ? msg.cost.toFixed(4) : msg.cost.toFixed(2)}</span>}
                      {msg.usage && <span>{((msg.usage.input_tokens || 0) / 1000).toFixed(1)}k in</span>}
                      {msg.usage && <span>{((msg.usage.output_tokens || 0) / 1000).toFixed(1)}k out</span>}
                      {msg.numTurns > 0 && <span>{msg.numTurns} {msg.numTurns === 1 ? "turn" : "turns"}</span>}
                      {msg.durationMs > 0 && <span>{(msg.durationMs / 1000).toFixed(1)}s</span>}
                      {msg.modelUsage && Object.entries(msg.modelUsage).map(([model, mu]) => {
                        const cost = mu.costUSD || 0;
                        const inTok = mu.inputTokens || 0;
                        const outTok = mu.outputTokens || 0;
                        return (
                          <span key={model} className="inline-flex items-center gap-1 rounded-md bg-muted/50 border border-border px-1.5 py-0.5">
                            <span className="font-medium text-foreground/70">{model.replace(/^claude-/, "").replace(/-\d{8}$/, "")}</span>
                            <span>${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)}</span>
                            <span className="text-muted-foreground/60">{(inTok / 1000).toFixed(1)}k/{(outTok / 1000).toFixed(1)}k</span>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {msg.type === "context_cleared" && (
                    <div className="flex items-center gap-3 my-3">
                      <div className="flex-1 border-t border-dashed border-yellow-500/50" />
                      <span className="text-xs text-yellow-500 font-medium whitespace-nowrap">Context cleared</span>
                      <div className="flex-1 border-t border-dashed border-yellow-500/50" />
                    </div>
                  )}
                  {msg.type === "error" && (
                    <div className="max-w-2xl bg-destructive/20 text-destructive rounded-lg px-4 py-2">
                      {msg.message}
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </ScrollArea>
            <SuggestionBar suggestions={suggestions} options={options} onSelect={handleSend} />
            <ChatInput onSend={handleSend} onClearContext={handleClearContext} connected={connected} />
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

function ChatInput({ onSend, onClearContext, connected }) {
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
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClearContext}
          disabled={!connected}
          title="Clear context"
          className="text-muted-foreground hover:text-yellow-500"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
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
