import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Send, Square, Trash2, Menu, TerminalSquare, MessageCircleQuestion, Paperclip, WifiOff, Copy, CopyCheck } from "lucide-react";
import Sidebar from "./components/Sidebar.jsx";
import ToolCallCard from "./components/ToolCallCard.jsx";
import QuestionCard from "./components/QuestionCard.jsx";
import Markdown from "./components/Markdown.jsx";
import LoginScreen from "./components/LoginScreen.jsx";
import SuggestionBar from "./components/SuggestionBar.jsx";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useAgents } from "./hooks/useAgents.js";
import { useWebSocket } from "./hooks/useWebSocket.js";
import { useWorkspace } from "./hooks/useWorkspace.js";
import { useNotifications } from "./hooks/useNotifications.js";
import { useUsageStats } from "./hooks/useUsageStats.js";
import StatusBar from "./components/StatusBar.jsx";
import Terminal from "./components/Terminal.jsx";

export default function App() {
  const [authenticated, setAuthenticated] = useState(null); // null = loading
  const [profile, setProfile] = useState(null); // { id, name, slug } or null
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const [conversations, setConversations] = useState({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [interactiveQuestions, setInteractiveQuestions] = useState({});
  const [pendingQuestions, setPendingQuestions] = useState({});
  const [copiedMsgIdx, setCopiedMsgIdx] = useState(null);
  const terminalDataRef = useRef(null);
  const { agents, gitStatuses, fetchAgents, createAgent, cloneRepo, removeAgent, updateAgentStatus, findAgentByWorkDir, fetchGitStatus, fetchAllGitStatuses } = useAgents();
  const { directories, fetchDirectories } = useWorkspace();
  const { enabled: notificationsEnabled, toggle: toggleNotifications, notify } = useNotifications();
  const { usage, refresh: refreshUsage } = useUsageStats();
  const messagesEndRef = useRef(null);
  const lastEventIndexRef = useRef({});
  const reconnectHandlerRef = useRef(null);

  const handleWsMessage = useCallback(
    (msg) => {
      const { agentId, type, ...rest } = msg;
      if (!agentId) return;

      // Deduplicate backfill events by eventIndex to handle race between
      // async history reload and incoming backfill messages
      if (msg.eventIndex != null) {
        const seen = lastEventIndexRef.current[agentId] || 0;
        if (msg.backfill && msg.eventIndex <= seen) {
          return; // Already processed this event
        }
        lastEventIndexRef.current[agentId] = Math.max(seen, msg.eventIndex);
      }

      if (type === "terminal_output") {
        if (terminalDataRef.current) {
          terminalDataRef.current(msg.data);
        }
        return;
      }

      if (type === "question_pending") {
        setPendingQuestions((prev) => ({
          ...prev,
          [agentId]: { input: rest.input, toolUseId: rest.toolUseId },
        }));
        return;
      }

      if (type === "agent_status") {
        updateAgentStatus(agentId, rest.status);
        // Reload conversation from disk to get clean state
        fetch(`/api/agents/${agentId}/history`)
          .then((r) => r.ok ? r.json() : [])
          .then((entries) => {
            if (entries.length > 0) {
              setConversations((prev) => ({ ...prev, [agentId]: entries }));
            }
          })
          .catch(() => {});
        return;
      }

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
        setPendingQuestions((prev) => { const next = { ...prev }; delete next[agentId]; return next; });
        refreshUsage();
        fetchGitStatus(agentId);
        const agent = agents.find((a) => a.id === agentId);
        notify("Agent finished", { body: agent?.name || agentId });
      } else if (type === "error") {
        setConversations((prev) => {
          const conv = prev[agentId] || [];
          return { ...prev, [agentId]: [...conv, { type: "error", message: rest.message }] };
        });
        updateAgentStatus(agentId, "error");
        setPendingQuestions((prev) => { const next = { ...prev }; delete next[agentId]; return next; });
        notify("Agent error", { body: rest.message });
      }
    },
    [updateAgentStatus, agents, notify, refreshUsage, fetchGitStatus]
  );

  const handleServerRestart = useCallback(() => {
    setConversations((prev) => {
      const next = {};
      for (const [agentId, conv] of Object.entries(prev)) {
        // Only add indicator if there are existing messages and last entry isn't already a context_cleared
        if (conv.length > 0 && conv[conv.length - 1].type !== "context_cleared") {
          next[agentId] = [...conv, { type: "context_cleared", timestamp: Date.now() }];
        } else {
          next[agentId] = conv;
        }
      }
      return next;
    });
  }, []);

  const { send, connected, reconnect } = useWebSocket(handleWsMessage, handleServerRestart, () => reconnectHandlerRef.current?.());

  // Ref indirection: handleReconnect needs `send` (from useWebSocket) and `agents`
  // (latest state), but useWebSocket takes it as a parameter. The ref breaks this
  // circular dependency while always providing the latest closure values.
  reconnectHandlerRef.current = () => {
    for (const agent of agents) {
      if (agent.status === "busy") {
        send({
          type: "subscribe",
          agentId: agent.id,
          lastEventIndex: lastEventIndexRef.current[agent.id] || 0,
        });
      }
    }
    fetchAgents();
  };

  const selectedConversation = conversations[selectedAgentId] || [];

  // Group tool_call messages (excluding AskUserQuestion) into grids.
  // tool_result entries between tool calls are skipped (looked up by toolUseId).
  // assistant_stream entries between tool calls close the current grid, render
  // as a text bubble, then a new grid is started for subsequent tool calls –
  // keeping them visually compact while preserving correct message order.
  const groupedConversation = useMemo(() => {
    const groups = [];
    let toolGroup = null;
    let inToolRun = false; // true while we're in a sequence of tool calls
    for (const msg of selectedConversation) {
      const isToolTile = msg.type === "tool_call" && msg.tool !== "AskUserQuestion";
      if (isToolTile) {
        inToolRun = true;
        if (!toolGroup) {
          toolGroup = { type: "tool_group", msgs: [] };
          groups.push(toolGroup);
        }
        toolGroup.msgs.push(msg);
      } else if (msg.type === "tool_result") {
        // skip – looked up by toolUseId when rendering
        continue;
      } else if (inToolRun && msg.type === "assistant_stream") {
        // Assistant text mid-run: close current grid, emit text, prepare for
        // a new grid if more tool calls follow.
        toolGroup = null;
        groups.push({ type: "single", msg });
        // inToolRun stays true so the next tool_call starts a fresh grid
      } else {
        toolGroup = null;
        inToolRun = false;
        groups.push({ type: "single", msg });
      }
    }
    return groups;
  }, [selectedConversation]);

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
  const gitStatus = selectedAgentId ? gitStatuses[selectedAgentId] : null;
  const hasPR = !!(gitStatus?.pr);
  const prLabel = gitStatus?.pr?.provider === "gitlab" ? "MR" : "PR";

  const { suggestions, options, actions } = (() => {
    const conv = selectedConversation;
    if (conv.length === 0) return { suggestions: [], options: [], actions: [] };
    const lastEntry = conv[conv.length - 1];

    // Compute contextual suggestions
    let sugg = [];
    let acts = [];
    if (lastEntry.type === "stats") {
      sugg = ["Continue", "Summarize changes", "Commit changes", "Push code"];
      if (hasPR) {
        sugg.push(`Review ${prLabel}`);
        // Check if assistant responses look like a review (consider all messages)
        const assistantMsgs = conv.filter((m) => m.type === "assistant_stream");
        const totalLen = assistantMsgs.reduce((sum, m) => sum + m.text.length, 0);
        if (assistantMsgs.length > 0 && totalLen > 100) {
          acts.push({ label: `Post review to ${prLabel}`, action: "post-pr-review" });
        }
      }
    } else if (lastEntry.type === "error") {
      sugg = ["Try again", "Explain the error"];
    } else if (lastEntry.type === "context_cleared") {
      sugg = ["Start fresh"];
    } else {
      return { suggestions: [], options: [], actions: [] };
    }

    // Check if recent entries include Bash tool calls
    const recentSlice = conv.slice(-20);
    if (recentSlice.some((m) => m.type === "tool_call" && m.tool === "Bash")) {
      if (!sugg.includes("Run tests")) sugg.push("Run tests");
    }

    return { suggestions: sugg, options: [], actions: acts };
  })();

  useEffect(() => {
    fetch("/api/auth/check")
      .then((r) => r.json())
      .then((data) => {
        setAuthenticated(data.authenticated);
        if (data.authenticated && data.profile) {
          setProfile(data.profile);
        }
      })
      .catch(() => setAuthenticated(false));
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    fetchAgents().then(() => {
      // Sync interactiveQuestions state from server
      fetch("/api/agents")
        .then((r) => r.json())
        .then((list) => {
          const iq = {};
          for (const a of list) {
            iq[a.id] = !!a.interactiveQuestions;
          }
          setInteractiveQuestions((prev) => ({ ...prev, ...iq }));
        })
        .catch(() => {});
    });
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
    // Recover pending question state from server (e.g. after page reload)
    fetch(`/api/agents/${selectedAgentId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.pendingQuestion) {
          setPendingQuestions((prev) => ({
            ...prev,
            [selectedAgentId]: { input: data.pendingQuestion.input, toolUseId: data.pendingQuestion.toolUseId },
          }));
        }
        if (data?.interactiveQuestions !== undefined) {
          setInteractiveQuestions((prev) => ({ ...prev, [selectedAgentId]: !!data.interactiveQuestions }));
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

  function handleStop() {
    if (!selectedAgentId) return;
    send({ type: "abort", agentId: selectedAgentId });
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

  async function handleDeleteProject(dirName, agentId) {
    try {
      const res = await fetch(`/api/workspace/${encodeURIComponent(dirName)}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to delete project");
        return;
      }
      // Clean up agent state if one was associated
      if (agentId) {
        if (selectedAgentId === agentId) setSelectedAgentId(null);
        setConversations((prev) => { const next = { ...prev }; delete next[agentId]; return next; });
      }
      fetchAgents();
      fetchDirectories();
    } catch {
      alert("Failed to delete project");
    }
  }

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {}
    setAuthenticated(false);
    setProfile(null);
    setSelectedAgentId(null);
    setConversations({});
  }

  async function handleToggleInteractiveQuestions() {
    if (!selectedAgentId) return;
    const newValue = !interactiveQuestions[selectedAgentId];
    setInteractiveQuestions((prev) => ({ ...prev, [selectedAgentId]: newValue }));
    try {
      await fetch(`/api/agents/${selectedAgentId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interactiveQuestions: newValue }),
      });
    } catch {}
  }

  function handleAnswerQuestion(agentId, answers) {
    send({ type: "question_answer", agentId, answers });
    setPendingQuestions((prev) => { const next = { ...prev }; delete next[agentId]; return next; });
  }

  async function handlePostReview() {
    if (!selectedAgentId) return;
    // Collect all assistant messages from the current session (after last context_cleared)
    const conv = selectedConversation;
    let startIdx = 0;
    for (let i = conv.length - 1; i >= 0; i--) {
      if (conv[i].type === "context_cleared") { startIdx = i + 1; break; }
    }
    const assistantMessages = conv.slice(startIdx).filter((m) => m.type === "assistant_stream");
    if (assistantMessages.length === 0) return;
    const reviewBody = assistantMessages.map((m) => m.text).join("\n\n---\n\n");

    try {
      const res = await fetch(`/api/agents/${selectedAgentId}/pr-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reviewBody }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const providerLabel = data.provider === "gitlab" ? "MR" : "PR";
      setConversations((prev) => ({
        ...prev,
        [selectedAgentId]: [...(prev[selectedAgentId] || []), {
          type: "assistant_stream",
          text: `Review posted to ${providerLabel}. [View ${providerLabel}](${data.url})`,
        }],
      }));
    } catch (err) {
      setConversations((prev) => ({
        ...prev,
        [selectedAgentId]: [...(prev[selectedAgentId] || []), {
          type: "error",
          message: `Failed to post review: ${err.message}`,
        }],
      }));
    }
  }

  function handleSuggestionAction(action) {
    if (action === "post-pr-review") {
      handlePostReview();
    }
  }

  if (authenticated === null) {
    return <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">Loading...</div>;
  }

  if (!authenticated) {
    return <LoginScreen onSuccess={(profileData) => { setAuthenticated(true); setProfile(profileData || null); }} />;
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
          onCreate={async (name, localOnlyOrWorkDir, provider) => { const a = await createAgent(name, localOnlyOrWorkDir, provider); fetchDirectories(); return a; }}
          onClone={async (repoFullName, provider) => { const a = await cloneRepo(repoFullName, provider); fetchDirectories(); return a; }}
          onDelete={handleDeleteAgent}
          onDeleteProject={handleDeleteProject}
          onBranchChange={fetchGitStatus}
          directories={directories}
          findAgentByWorkDir={findAgentByWorkDir}
          notificationsEnabled={notificationsEnabled}
          toggleNotifications={toggleNotifications}
          gitStatuses={gitStatuses}
          profile={profile}
          onLogout={handleLogout}
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
          <StatusBar usage={usage} connected={connected} contextInfo={contextInfo} onCompact={selectedAgentId ? handleClearContext : null} className="flex-1 border-b-0" />
          {selectedAgentId && (
            <Button
              variant="ghost"
              size="icon"
              className={cn("shrink-0 mr-2", terminalOpen && "text-primary")}
              onClick={() => setTerminalOpen((v) => !v)}
              title="Toggle Claude CLI"
            >
              <TerminalSquare className="h-5 w-5" />
            </Button>
          )}
        </div>
        {selectedAgentId ? (
          <>
            {!terminalOpen && (
              <div className="flex flex-col min-h-0 flex-1">
                <ScrollArea className="flex-1 p-4">
                  {groupedConversation.map((group, gi) => {
                    if (group.type === "tool_group") {
                      return (
                        <div key={`tg-${gi}`} className="grid grid-cols-2 md:grid-cols-3 gap-2 my-1 text-sm">
                          {group.msgs.map((msg, ti) => (
                            <ToolCallCard
                              key={ti}
                              tool={msg.tool}
                              input={msg.input}
                              output={selectedConversation.find(
                                (m) => m.type === "tool_result" && m.toolUseId === msg.toolUseId
                              )?.output}
                            />
                          ))}
                        </div>
                      );
                    }
                    const msg = group.msg;
                    return (
                      <div key={gi} className="mb-2 text-sm">
                        {msg.type === "user" && (
                          <div className="max-w-lg bg-primary text-primary-foreground rounded-lg px-4 py-2 w-fit ml-auto">
                            {msg.text}
                          </div>
                        )}
                        {msg.type === "assistant_stream" && (
                          <div className="group/msg relative max-w-2xl bg-card border border-border rounded-lg px-4 py-2">
                            <button
                              className="absolute top-1.5 right-1.5 opacity-0 group-hover/msg:opacity-100 transition-opacity p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                              title="Copy markdown"
                              onClick={() => {
                                navigator.clipboard.writeText(msg.text);
                                setCopiedMsgIdx(gi);
                                setTimeout(() => setCopiedMsgIdx(null), 1500);
                              }}
                            >
                              {copiedMsgIdx === gi ? <CopyCheck className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                            </button>
                            <Markdown>{msg.text}</Markdown>
                          </div>
                        )}
                        {msg.type === "tool_call" && msg.tool === "AskUserQuestion" && (
                          <QuestionCard
                            input={msg.input}
                            output={selectedConversation.find(
                              (m) => m.type === "tool_result" && m.toolUseId === msg.toolUseId
                            )?.output}
                            interactive={pendingQuestions[selectedAgentId]?.toolUseId === msg.toolUseId}
                            onAnswer={({ answers }) => handleAnswerQuestion(selectedAgentId, answers)}
                          />
                        )}
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
                    );
                  })}
                  <div ref={messagesEndRef} />
                </ScrollArea>
                <SuggestionBar suggestions={suggestions} options={options} actions={actions} onSelect={handleSend} onAction={handleSuggestionAction} />
                <ChatInput onSend={handleSend} onStop={handleStop} onClearContext={handleClearContext} onReconnect={reconnect} connected={connected} isBusy={agents.find((a) => a.id === selectedAgentId)?.status === "busy"} interactiveQuestions={!!interactiveQuestions[selectedAgentId]} onToggleQuestions={handleToggleInteractiveQuestions} />
              </div>
            )}
            {terminalOpen && (
              <div className="flex-1 bg-[#1a1a1a]">
                <Terminal
                  agentId={selectedAgentId}
                  send={send}
                  visible={terminalOpen}
                  onDataRef={terminalDataRef}
                />
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3 p-8">
            <div className="h-16 w-16 rounded-2xl bg-muted/30 border border-border/50 flex items-center justify-center mb-2">
              <Menu className="h-8 w-8 text-muted-foreground/30" />
            </div>
            <p className="text-sm font-medium text-foreground/60">No project selected</p>
            <p className="text-xs text-muted-foreground/60 text-center max-w-xs">
              Select a project from the sidebar or create a new one to start chatting with Claude
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ChatInput({ onSend, onStop, onClearContext, onReconnect, connected, isBusy, interactiveQuestions, onToggleQuestions }) {
  const [text, setText] = useState("");
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  function resetHeight() {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    }
  }

  function handleChange(e) {
    setText(e.target.value);
    resetHeight();
  }

  function handleSubmit(e) {
    e?.preventDefault();
    if (text.trim()) {
      onSend(text);
      setText("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleFileSelect(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    let pending = files.length;
    const results = [];

    files.forEach((file, idx) => {
      const reader = new FileReader();
      reader.onload = () => {
        results[idx] = `<file path="${file.name}">\n${reader.result}\n</file>\n`;
        pending--;
        if (pending === 0) {
          const prefix = results.join("\n");
          setText((prev) => prefix + (prev ? "\n" + prev : ""));
          // Reset height after state update
          requestAnimationFrame(() => resetHeight());
        }
      };
      reader.onerror = () => {
        results[idx] = `<file path="${file.name}">\n[Error: could not read file]\n</file>\n`;
        pending--;
        if (pending === 0) {
          const prefix = results.join("\n");
          setText((prev) => prefix + (prev ? "\n" + prev : ""));
          requestAnimationFrame(() => resetHeight());
        }
      };
      reader.readAsText(file);
    });

    // Reset the input so re-selecting the same file works
    e.target.value = "";
  }

  return (
    <form onSubmit={handleSubmit} className="p-4 border-t border-border bg-background sticky bottom-0 z-10">
      <div className="flex gap-2 items-end">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClearContext}
          disabled={!connected}
          title="Clear context"
          className="text-muted-foreground hover:text-yellow-500 shrink-0"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onToggleQuestions}
          title={interactiveQuestions ? "Questions: interactive (click to auto-answer)" : "Questions: auto-answer (click to make interactive)"}
          className={cn("shrink-0", interactiveQuestions ? "text-primary" : "text-muted-foreground hover:text-foreground")}
        >
          <MessageCircleQuestion className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => fileInputRef.current?.click()}
          disabled={!connected}
          title="Attach files"
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={connected ? "Send a message..." : "Connecting..."}
          disabled={!connected}
          rows={1}
          className="flex-1 resize-none overflow-y-auto rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ maxHeight: "25vh" }}
        />
        {!connected ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onReconnect}
            title="Reconnect"
            className="shrink-0 text-yellow-500 border-yellow-500/50 hover:bg-yellow-500/10 hover:text-yellow-400"
          >
            <WifiOff className="h-4 w-4" />
          </Button>
        ) : isBusy ? (
          <Button
            type="button"
            variant="destructive"
            size="icon"
            onClick={onStop}
            title="Stop agent"
            className="shrink-0"
          >
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            type="submit"
            disabled={!text.trim()}
            size="icon"
            className="shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
    </form>
  );
}
