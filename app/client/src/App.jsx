import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { flushSync } from "react-dom";
import { Send, Square, Trash2, Eraser, Menu, TerminalSquare, FileCode, MessageCircleQuestion, Paperclip, WifiOff, Copy, CopyCheck, Clock, FileText, X, Loader2, Cpu, ChevronDown, Check, ArrowDown, Image as ImageIcon } from "lucide-react";
import Sidebar from "./components/Sidebar.jsx";
import ToolCallCard from "./components/ToolCallCard.jsx";
import ErrorCard from "./components/ErrorCard.jsx";
import QuestionCard from "./components/QuestionCard.jsx";
import Markdown from "./components/Markdown.jsx";
import LoginScreen from "./components/LoginScreen.jsx";
import ClaudeSetupBanner from "./components/ClaudeSetupBanner.jsx";
import SuggestionBar from "./components/SuggestionBar.jsx";
import TasksPage from "./components/TasksPage.jsx";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { getModelShortLabel } from "@/lib/models";
import { useModels } from "./hooks/useModels.js";
import { useAgents } from "./hooks/useAgents.js";
import { useWebSocket } from "./hooks/useWebSocket.js";
import { useWorkspace } from "./hooks/useWorkspace.js";
import { useNotifications } from "./hooks/useNotifications.js";
import { useUsageStats } from "./hooks/useUsageStats.js";
import { useSuggestions } from "./hooks/useSuggestions.js";
import SuggestionManager from "./components/SuggestionManager.jsx";
import StatusBar from "./components/StatusBar.jsx";
import Terminal from "./components/Terminal.jsx";
import CodeEditor from "./components/CodeEditor.jsx";

export default function App() {
  const [authenticated, setAuthenticated] = useState(null); // null = loading
  const [profile, setProfile] = useState(null); // { id, name, slug } or null
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const [conversations, setConversations] = useState({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [currentView, setCurrentView] = useState("chat"); // "chat" | "schedules"
  const [scheduleCount, setScheduleCount] = useState(0);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [interactiveQuestions, setInteractiveQuestions] = useState({});
  const [agentModels, setAgentModels] = useState({});  // agentId -> model string
  const [pendingQuestions, setPendingQuestions] = useState({});
  const [copiedMsgIdx, setCopiedMsgIdx] = useState(null);
  const [queuedMessages, setQueuedMessages] = useState({}); // agentId -> [{ text }, ...] (FIFO queue)
  const [drafts, setDrafts] = useState({}); // agentId -> { text, attachedFiles }
  const terminalDataRef = useRef(null);
  const { agents, gitStatuses, fetchAgents, createAgent, cloneRepo, removeAgent, updateAgentStatus, findAgentByWorkDir, fetchGitStatus, fetchAllGitStatuses, removeWorktree, removeWorktreeByPath, deleteAllLocalBranches } = useAgents();
  const { projects, fetchDirectories, loaded: projectsLoaded } = useWorkspace();
  const { enabled: notificationsEnabled, permissionDenied: notificationsPermissionDenied, toggle: toggleNotifications, notify } = useNotifications();
  const { usage, refresh: refreshUsage } = useUsageStats();
  // Dynamic model list — fetched from /api/models on mount and refreshed
  // every 1h by the hook itself. Replaces the previous hardcoded import.
  const { models: modelOptions } = useModels();
  const {
    suggestions: allSuggestions,
    fetchSuggestions,
    createSuggestion: createSugg,
    updateSuggestion: updateSugg,
    deleteSuggestion: deleteSugg,
    reorderSuggestions: reorderSuggs,
  } = useSuggestions();
  const [suggestionManagerOpen, setSuggestionManagerOpen] = useState(false);
  const messagesEndRef = useRef(null);
  const scrollAreaRef = useRef(null);
  const isLoadingMoreRef = useRef(false);
  const didLoadMoreRef = useRef(false);
  const autoScrollRef = useRef(true);
  const [showScrollDown, setShowScrollDown] = useState(false);
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

      if (type === "message_queued") {
        setQueuedMessages((prev) => ({ ...prev, [agentId]: [...(prev[agentId] || []), { text: rest.text }] }));
        return;
      }

      if (type === "message_dequeued") {
        // Pending message is now being processed — promote the first pending_user to regular user message
        setQueuedMessages((prev) => {
          const queue = prev[agentId] || [];
          const remaining = queue.slice(1);
          if (remaining.length === 0) { const next = { ...prev }; delete next[agentId]; return next; }
          return { ...prev, [agentId]: remaining };
        });
        setConversations((prev) => {
          const data = prev[agentId] || { entries: [], total: 0, hasMore: false };
          let promoted = false;
          const entries = data.entries.map((m) => {
            if (!promoted && m.type === "pending_user") {
              promoted = true;
              return { type: "user", text: m.text, timestamp: m.timestamp || Date.now() };
            }
            return m;
          });
          return { ...prev, [agentId]: { ...data, entries } };
        });
        return;
      }

      if (type === "agent_status") {
        updateAgentStatus(agentId, rest.status);
        fetch(`/api/agents/${agentId}/history?limit=50&offset=0`)
          .then((r) => r.ok ? r.json() : { entries: [], total: 0 })
          .then(({ entries, total }) => {
            if (entries.length > 0) {
              setConversations((prev) => ({
                ...prev,
                [agentId]: { entries, total, hasMore: entries.length < total },
              }));
            }
          })
          .catch(() => {});
        return;
      }

      if (type === "text_delta") {
        setConversations((prev) => {
          const data = prev[agentId] || { entries: [], total: 0, hasMore: false };
          const last = data.entries[data.entries.length - 1];
          if (last && last.type === "assistant_stream") {
            return { ...prev, [agentId]: { ...data, entries: [...data.entries.slice(0, -1), { ...last, text: last.text + rest.text }] } };
          }
          return { ...prev, [agentId]: { ...data, entries: [...data.entries, { type: "assistant_stream", text: rest.text }], total: data.total + 1 } };
        });
        updateAgentStatus(agentId, "busy");
      } else if (type === "tool_call") {
        setConversations((prev) => {
          const data = prev[agentId] || { entries: [], total: 0, hasMore: false };
          return { ...prev, [agentId]: { ...data, entries: [...data.entries, { type: "tool_call", tool: rest.tool, input: rest.input, toolUseId: rest.toolUseId }], total: data.total + 1 } };
        });
      } else if (type === "tool_result") {
        setConversations((prev) => {
          const data = prev[agentId] || { entries: [], total: 0, hasMore: false };
          return { ...prev, [agentId]: { ...data, entries: [...data.entries, { type: "tool_result", toolUseId: rest.toolUseId, output: rest.output }], total: data.total + 1 } };
        });
      } else if (type === "done") {
        setConversations((prev) => {
          const data = prev[agentId] || { entries: [], total: 0, hasMore: false };
          return {
            ...prev,
            [agentId]: { ...data, entries: [...data.entries, {
              type: "stats",
              cost: rest.cost,
              usage: rest.usage,
              modelUsage: rest.modelUsage,
              numTurns: rest.numTurns,
              durationMs: rest.durationMs,
            }], total: data.total + 1 },
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
          const data = prev[agentId] || { entries: [], total: 0, hasMore: false };
          const errorEntry = {
            type: "error",
            message: rest.message,
            name: rest.name || null,
            stack: rest.stack || null,
            code: rest.code || null,
            details: rest.details || null,
            timestamp: rest.timestamp || Date.now(),
          };
          return { ...prev, [agentId]: { ...data, entries: [...data.entries, errorEntry], total: data.total + 1 } };
        });
        updateAgentStatus(agentId, "error");
        setPendingQuestions((prev) => { const next = { ...prev }; delete next[agentId]; return next; });
        setQueuedMessages((prev) => { const next = { ...prev }; delete next[agentId]; return next; });
        notify("Agent error", { body: rest.message });
      }
    },
    [updateAgentStatus, agents, notify, refreshUsage, fetchGitStatus]
  );

  const handleServerRestart = useCallback(() => {
    setConversations((prev) => {
      const next = {};
      for (const [agentId, data] of Object.entries(prev)) {
        const entries = data?.entries || [];
        if (entries.length > 0 && entries[entries.length - 1].type !== "context_cleared") {
          next[agentId] = { ...data, entries: [...entries, { type: "context_cleared", timestamp: Date.now() }], total: (data?.total || 0) + 1 };
        } else {
          next[agentId] = data;
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

  const selectedConversation = conversations[selectedAgentId]?.entries || [];

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

  // Context-aware suggestion computation from configurable suggestions
  const gitStatus = selectedAgentId ? gitStatuses[selectedAgentId] : null;
  const hasPR = !!(gitStatus?.pr);
  const prLabel = gitStatus?.pr?.provider === "gitlab" ? "MR" : "PR";

  const { activeSuggestions, activeActions } = useMemo(() => {
    const conv = selectedConversation;
    if (allSuggestions.length === 0) {
      return { activeSuggestions: [], activeActions: [] };
    }

    // Derive active context tags based on conversation state
    const activeContextTags = new Set();

    if (conv.length === 0) {
      // No conversation yet — agent is idle
      activeContextTags.add("idle");
    } else {
      const lastEntry = conv[conv.length - 1];

      if (lastEntry.type === "stats") {
        activeContextTags.add("after_completion");
        activeContextTags.add("git");
        activeContextTags.add("idle");
      } else if (lastEntry.type === "error") {
        activeContextTags.add("after_error");
        activeContextTags.add("recovery");
        activeContextTags.add("idle");
      } else if (lastEntry.type === "context_cleared") {
        activeContextTags.add("after_context_cleared");
        activeContextTags.add("fresh_start");
        activeContextTags.add("idle");
      } else {
        return { activeSuggestions: [], activeActions: [] };
      }
    }

    // Conditional context tags
    if (hasPR) activeContextTags.add("has_pr");

    const assistantMsgs = conv.filter((m) => m.type === "assistant_stream");
    const totalLen = assistantMsgs.reduce((sum, m) => sum + m.text.length, 0);
    if (hasPR && assistantMsgs.length > 0 && totalLen > 100) {
      activeContextTags.add("has_review_content");
    }

    const recentSlice = conv.slice(-20);
    if (recentSlice.some((m) => m.type === "tool_call" && m.tool === "Bash")) {
      activeContextTags.add("has_bash_calls");
    }

    // Filter: only enabled suggestions with at least one matching context tag
    const eligible = allSuggestions.filter(
      (s) => s.enabled && s.contextTags.some((tag) => activeContextTags.has(tag))
    );

    // Score: count of matching context tags (higher = more relevant)
    const scored = eligible.map((s) => ({
      ...s,
      relevanceScore: s.contextTags.filter((tag) => activeContextTags.has(tag)).length,
      // Interpolate template variables
      displayName: s.name.replace(/\{\{prLabel\}\}/g, prLabel),
      resolvedValue: s.actionValue.replace(/\{\{prLabel\}\}/g, prLabel),
    }));

    // Sort: primary by relevanceScore desc, secondary by order asc
    scored.sort((a, b) => {
      if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore;
      return a.order - b.order;
    });

    // Separate platform actions from regular suggestions
    const regularSuggestions = scored.filter((s) => s.actionType !== "platform");
    const platformActions = scored.filter((s) => s.actionType === "platform");

    return {
      activeSuggestions: regularSuggestions,
      activeActions: platformActions,
    };
  }, [selectedConversation, allSuggestions, hasPR, prLabel]);

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
      // Sync interactiveQuestions and model state from server
      fetch("/api/agents")
        .then((r) => r.json())
        .then((list) => {
          const iq = {};
          const models = {};
          for (const a of list) {
            iq[a.id] = !!a.interactiveQuestions;
            if (a.model) models[a.id] = a.model;
          }
          setInteractiveQuestions((prev) => ({ ...prev, ...iq }));
          setAgentModels((prev) => ({ ...prev, ...models }));
        })
        .catch(() => {});
    });
    fetchDirectories();
    fetchSuggestions();
  }, [authenticated, fetchAgents, fetchDirectories, fetchSuggestions]);

  // Use a ref for conversations to avoid stale closures in the agent-switch effect,
  // without adding conversations to the dependency array (which would re-run on every message).
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

  useEffect(() => {
    if (!selectedAgentId) return;

    // Helper: fetch and set history for this agent
    function fetchHistory(force) {
      fetch(`/api/agents/${selectedAgentId}/history?limit=50&offset=0`)
        .then((r) => r.ok ? r.json() : { entries: [], total: 0 })
        .then(({ entries, total }) => {
          if (entries.length > 0 || total === 0) {
            setConversations((prev) => {
              // If not forced, don't overwrite existing data
              if (!force && prev[selectedAgentId]?.entries?.length) return prev;
              return {
                ...prev,
                [selectedAgentId]: { entries, total, hasMore: entries.length < total },
              };
            });
          }
        })
        .catch(() => {});
    }

    // Always fetch latest agent details (status, pending question, model)
    // so we have accurate state after switching.
    fetch(`/api/agents/${selectedAgentId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data) return;
        // Update agent status so the UI reflects current state immediately
        if (data.status) {
          updateAgentStatus(selectedAgentId, data.status);
        }
        if (data.pendingQuestion) {
          setPendingQuestions((prev) => ({
            ...prev,
            [selectedAgentId]: { input: data.pendingQuestion.input, toolUseId: data.pendingQuestion.toolUseId },
          }));
        }
        if (data.interactiveQuestions !== undefined) {
          setInteractiveQuestions((prev) => ({ ...prev, [selectedAgentId]: !!data.interactiveQuestions }));
        }
        if (data.model) {
          setAgentModels((prev) => ({ ...prev, [selectedAgentId]: data.model }));
        }

        // If the agent is busy, always force-refresh history to get the latest state.
        // For idle agents, only fetch if we don't already have cached data.
        const hasCachedData = conversationsRef.current[selectedAgentId]?.entries?.length > 0;
        if (data.status === "busy") {
          fetchHistory(true);
        } else if (!hasCachedData) {
          fetchHistory(false);
        }
      })
      .catch(() => {
        // Agent details fetch failed — still try to load history if no cached data
        const hasCachedData = conversationsRef.current[selectedAgentId]?.entries?.length > 0;
        if (!hasCachedData) {
          fetchHistory(false);
        }
      });
  }, [selectedAgentId]);

  useEffect(() => {
    if (didLoadMoreRef.current) {
      didLoadMoreRef.current = false;
      return;
    }
    if (!autoScrollRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selectedConversation]);

  const loadMoreMessages = useCallback(async () => {
    if (!selectedAgentId) return;
    const conv = conversations[selectedAgentId];
    if (!conv || !conv.hasMore || isLoadingMoreRef.current) return;
    isLoadingMoreRef.current = true;

    const scrollEl = scrollAreaRef.current?.querySelector("[data-scroll-viewport]");
    const prevScrollHeight = scrollEl?.scrollHeight || 0;

    try {
      const offset = conv.entries.length;
      const res = await fetch(`/api/agents/${selectedAgentId}/history?limit=50&offset=${offset}`);
      if (!res.ok) return;
      const { entries: older, total } = await res.json();
      if (older.length === 0) return;

      didLoadMoreRef.current = true;

      // Use flushSync so the DOM updates synchronously, allowing us to
      // measure the new scrollHeight and restore position immediately
      // without a rAF race condition.
      flushSync(() => {
        setConversations((prev) => {
          const existing = prev[selectedAgentId];
          if (!existing) return prev;
          const merged = [...older, ...existing.entries];
          return {
            ...prev,
            [selectedAgentId]: {
              entries: merged,
              total,
              hasMore: merged.length < total,
            },
          };
        });
      });

      if (scrollEl) {
        const newScrollHeight = scrollEl.scrollHeight;
        scrollEl.scrollTop = newScrollHeight - prevScrollHeight;
      }
    } catch {
      // ignore fetch errors
    } finally {
      isLoadingMoreRef.current = false;
    }
  }, [selectedAgentId, conversations]);

  useEffect(() => {
    const scrollEl = scrollAreaRef.current?.querySelector("[data-scroll-viewport]");
    if (!scrollEl) return;

    const handleScroll = () => {
      // Load more when scrolled near top
      if (scrollEl.scrollTop < 50) {
        loadMoreMessages();
      }
      // Detect if user is near the bottom
      const distanceFromBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      if (distanceFromBottom < 60) {
        // User scrolled back to bottom — re-enable auto-scroll
        autoScrollRef.current = true;
        setShowScrollDown(false);
      } else {
        // User scrolled up — disable auto-scroll
        autoScrollRef.current = false;
        setShowScrollDown(true);
      }
    };

    scrollEl.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollEl.removeEventListener("scroll", handleScroll);
  }, [loadMoreMessages]);

  // Fetch task count for sidebar badge
  useEffect(() => {
    if (!authenticated) return;
    function refresh() {
      fetch("/api/tasks")
        .then((r) => r.ok ? r.json() : [])
        .then((data) => setScheduleCount(data.length))
        .catch(() => {});
    }
    refresh();
    const interval = setInterval(refresh, 60000);
    return () => clearInterval(interval);
  }, [authenticated]);

  function handleNavigate(view) {
    setCurrentView(view);
    if (view === "schedules") {
      setSelectedAgentId(null);
      setEditorOpen(false);
      setTerminalOpen(false);
    }
    setSidebarOpen(false);
  }

  function handleSelectAgent(id) {
    setSelectedAgentId(id);
    setCurrentView("chat");
    setSidebarOpen(false);
    setEditorOpen(false);
    setTerminalOpen(false);
    autoScrollRef.current = true;
    setShowScrollDown(false);

    // Always subscribe to the agent so we receive live updates if it's busy.
    // The server handles duplicate subscriptions gracefully (evicts old listener).
    if (id) {
      send({
        type: "subscribe",
        agentId: id,
        lastEventIndex: lastEventIndexRef.current[id] || 0,
      });
    }
  }

  function handleScrollToBottom() {
    autoScrollRef.current = true;
    setShowScrollDown(false);
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  function handleSend(text, attachments) {
    if (!selectedAgentId || (!text.trim() && (!attachments || attachments.length === 0))) return;
    // Re-enable auto-scroll when user sends a message
    autoScrollRef.current = true;
    setShowScrollDown(false);
    const agent = agents.find((a) => a.id === selectedAgentId);
    const isBusy = agent?.status === "busy";

    // Store attachment metadata (no binary data) for display in conversation
    const displayAttachments = attachments?.map((a) => ({ name: a.name, type: a.type, mediaType: a.mediaType })) || undefined;

    // Optimistically set agent to busy so the stop button appears immediately
    if (!isBusy) {
      updateAgentStatus(selectedAgentId, "busy");
    }

    if (isBusy) {
      // Append to the queue — multiple pending messages allowed
      setConversations((prev) => {
        const data = prev[selectedAgentId] || { entries: [], total: 0, hasMore: false };
        return { ...prev, [selectedAgentId]: { ...data, entries: [...data.entries, { type: "pending_user", text, attachments: displayAttachments }] } };
      });
    } else {
      setConversations((prev) => {
        const data = prev[selectedAgentId] || { entries: [], total: 0, hasMore: false };
        return { ...prev, [selectedAgentId]: { ...data, entries: [...data.entries, { type: "user", text, attachments: displayAttachments, timestamp: Date.now() }], total: data.total + 1 } };
      });
    }

    if (attachments && attachments.length > 0) {
      send({ type: "message", agentId: selectedAgentId, text, attachments });
    } else {
      send({ type: "message", agentId: selectedAgentId, text });
    }
  }

  function handleCancelPending(index) {
    if (!selectedAgentId) return;
    if (index != null) {
      // Cancel a single queued message by its index among pending_user entries
      setConversations((prev) => {
        const data = prev[selectedAgentId] || { entries: [], total: 0, hasMore: false };
        let pendingIdx = 0;
        const entries = data.entries.filter((m) => {
          if (m.type === "pending_user") {
            if (pendingIdx === index) { pendingIdx++; return false; }
            pendingIdx++;
          }
          return true;
        });
        return { ...prev, [selectedAgentId]: { ...data, entries } };
      });
      setQueuedMessages((prev) => {
        const queue = prev[selectedAgentId] || [];
        const remaining = queue.filter((_, i) => i !== index);
        if (remaining.length === 0) { const next = { ...prev }; delete next[selectedAgentId]; return next; }
        return { ...prev, [selectedAgentId]: remaining };
      });
      send({ type: "cancel_pending_one", agentId: selectedAgentId, index });
    } else {
      // Cancel all pending messages
      setConversations((prev) => {
        const data = prev[selectedAgentId] || { entries: [], total: 0, hasMore: false };
        const entries = data.entries.filter((m) => m.type !== "pending_user");
        return { ...prev, [selectedAgentId]: { ...data, entries } };
      });
      setQueuedMessages((prev) => { const next = { ...prev }; delete next[selectedAgentId]; return next; });
      send({ type: "cancel_pending", agentId: selectedAgentId });
    }
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
        setConversations((prev) => {
          const data = prev[selectedAgentId] || { entries: [], total: 0, hasMore: false };
          return {
            ...prev,
            [selectedAgentId]: { ...data, entries: [...data.entries, { type: "context_cleared", timestamp: Date.now() }], total: data.total + 1 },
          };
        });
      }
    } catch {}
  }

  async function handleCompact() {
    if (!selectedAgentId) return;
    try {
      // Triggers the SDK's native /compact slash command. Streaming events
      // (compact_boundary, status, etc.) flow back via the normal WebSocket
      // listener so no additional UI plumbing is needed here.
      await fetch(`/api/agents/${selectedAgentId}/compact`, { method: "POST" });
    } catch {}
  }

  async function handleDeleteHistory() {
    if (!selectedAgentId) return;
    try {
      const res = await fetch(`/api/agents/${selectedAgentId}/history`, { method: "DELETE" });
      if (res.ok) {
        setConversations((prev) => ({
          ...prev,
          [selectedAgentId]: { entries: [], total: 0, hasMore: false },
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
    setDrafts((prev) => {
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

  async function handleAddWorktree(data) {
    // data = { agent: { id, name, workingDirectory, ... }, worktree: { branch, path, isMain } }
    // The agent was already added to state by useAgents.addWorktree
    // Refresh workspace to reflect the new worktree in sidebar
    await fetchDirectories();
    // Select the new agent
    handleSelectAgent(data.agent.id);
    // Fetch git status for the new agent
    fetchGitStatus(data.agent.id);
  }

  async function handleRemoveWorktree(agentId) {
    try {
      await removeWorktree(agentId);
    } catch (err) {
      alert(err.message || "Failed to remove worktree");
      return;
    }
    if (selectedAgentId === agentId) setSelectedAgentId(null);
    setConversations((prev) => {
      const next = { ...prev };
      delete next[agentId];
      return next;
    });
    await fetchDirectories();
  }

  async function handleRemoveWorktreeByPath(projectName, worktreePath) {
    try {
      await removeWorktreeByPath(projectName, worktreePath);
    } catch (err) {
      alert(err.message || "Failed to remove worktree");
      return;
    }
    // Clean up selected agent if it was in the removed worktree
    const agentInWorktree = agents.find((a) => a.workingDirectory === worktreePath);
    if (agentInWorktree && selectedAgentId === agentInWorktree.id) {
      setSelectedAgentId(null);
    }
    if (agentInWorktree) {
      setConversations((prev) => {
        const next = { ...prev };
        delete next[agentInWorktree.id];
        return next;
      });
    }
    await fetchDirectories();
  }

  async function handleDeleteAllLocalBranches(agentId) {
    try {
      const result = await deleteAllLocalBranches(agentId);
      if (result.deleted && result.deleted.length > 0) {
        alert(`Deleted ${result.deleted.length} local branch${result.deleted.length === 1 ? "" : "es"}:\n${result.deleted.join(", ")}${result.skipped?.length ? `\n\nSkipped: ${result.skipped.map((s) => s.branch).join(", ")}` : ""}`);
      } else {
        alert("No branches to delete. Current branch, default branch, and branches with active worktrees are protected.");
      }
    } catch (err) {
      alert(err.message || "Failed to delete local branches");
    }
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

  async function handleSetModel(model) {
    if (!selectedAgentId) return;
    setAgentModels((prev) => {
      if (!model) { const next = { ...prev }; delete next[selectedAgentId]; return next; }
      return { ...prev, [selectedAgentId]: model };
    });
    try {
      await fetch(`/api/agents/${selectedAgentId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: model || null }),
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
      setConversations((prev) => {
        const d = prev[selectedAgentId] || { entries: [], total: 0, hasMore: false };
        return { ...prev, [selectedAgentId]: { ...d, entries: [...d.entries, {
          type: "assistant_stream",
          text: `Review posted to ${providerLabel}. [View ${providerLabel}](${data.url})`,
        }], total: d.total + 1 } };
      });
    } catch (err) {
      setConversations((prev) => {
        const d = prev[selectedAgentId] || { entries: [], total: 0, hasMore: false };
        return { ...prev, [selectedAgentId]: { ...d, entries: [...d.entries, {
          type: "error",
          message: `Failed to post review: ${err.message}`,
        }], total: d.total + 1 } };
      });
    }
  }

  function handleSuggestionAction(action) {
    if (action === "post-pr-review") {
      handlePostReview();
    }
  }

  function handleSuggestionSelect(suggestion) {
    if (suggestion.actionType === "platform") {
      handleSuggestionAction(suggestion.resolvedValue);
    } else {
      // "prompt" and "skill" both send text as user message
      handleSend(suggestion.resolvedValue);
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
          onClone={async (repoFullName, provider, accountId) => { const a = await cloneRepo(repoFullName, provider, accountId); fetchDirectories(); return a; }}
          onDelete={handleDeleteAgent}
          onDeleteProject={handleDeleteProject}
          onRefresh={async () => {
            await Promise.all([
              fetchDirectories(),
              fetchAgents(),
              fetchAllGitStatuses(),
            ]);
          }}
          projects={projects}
          projectsLoaded={projectsLoaded}
          findAgentByWorkDir={findAgentByWorkDir}
          notificationsEnabled={notificationsEnabled}
          notificationsPermissionDenied={notificationsPermissionDenied}
          toggleNotifications={toggleNotifications}
          gitStatuses={gitStatuses}
          profile={profile}
          onLogout={handleLogout}
          currentView={currentView}
          onNavigate={handleNavigate}
          scheduleCount={scheduleCount}
          onAddWorktree={handleAddWorktree}
          onRemoveWorktree={handleRemoveWorktree}
          onRemoveWorktreeByPath={handleRemoveWorktreeByPath}
          onDeleteAllLocalBranches={handleDeleteAllLocalBranches}
        />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center border-b border-border bg-card sticky top-0 z-20">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden shrink-0 ml-2"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <StatusBar
            usage={usage}
            connected={connected}
            contextInfo={contextInfo}
            onClearContext={selectedAgentId ? handleClearContext : null}
            onCompact={selectedAgentId ? handleCompact : null}
            className="flex-1 border-b-0"
          />
          {selectedAgentId && currentView === "chat" && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className={cn("shrink-0", editorOpen && "text-primary")}
                onClick={() => {
                  setEditorOpen((v) => !v);
                  if (!editorOpen) setTerminalOpen(false);
                }}
                title="Toggle Code Editor"
              >
                <FileCode className="h-5 w-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn("shrink-0 mr-2", terminalOpen && "text-primary")}
                onClick={() => {
                  setTerminalOpen((v) => !v);
                  if (!terminalOpen) setEditorOpen(false);
                }}
                title="Toggle Claude CLI"
              >
                <TerminalSquare className="h-5 w-5" />
              </Button>
            </>
          )}
        </div>
        <ClaudeSetupBanner />
        {currentView === "schedules" ? (
          <TasksPage />
        ) : selectedAgentId ? (
          <>
            {!terminalOpen && !editorOpen && (
              <div className="flex flex-col min-h-0 flex-1 relative">
                <ScrollArea ref={scrollAreaRef} className="flex-1 p-4">
                  {conversations[selectedAgentId]?.hasMore && (
                    <div className="flex justify-center py-2">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  {groupedConversation.map((group, gi) => {
                    if (group.type === "tool_group") {
                      return (
                        <div key={`tg-${gi}`} className="grid grid-cols-2 md:grid-cols-4 gap-2 my-1 text-sm">
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
                        {msg.type === "user" && (() => {
                          // Strip <file> XML blocks and show compact chips instead
                          const fileRegex = /<file\s+path="([^"]*)">\n[\s\S]*?\n<\/file>\n?/g;
                          const fileNames = [];
                          let match;
                          while ((match = fileRegex.exec(msg.text)) !== null) {
                            fileNames.push(match[1]);
                          }
                          const displayText = msg.text.replace(/<file\s+path="[^"]*">\n[\s\S]*?\n<\/file>\n?/g, "").trim();
                          const imageAttachments = (msg.attachments || []).filter((a) => a.type === "image");
                          const pdfAttachments = (msg.attachments || []).filter((a) => a.type === "pdf");
                          const hasChips = fileNames.length > 0 || imageAttachments.length > 0 || pdfAttachments.length > 0;
                          return (
                            <div className="max-w-full md:max-w-lg ml-auto space-y-1.5">
                              {hasChips && (
                                <div className="flex flex-wrap gap-1 justify-end">
                                  {fileNames.map((name, i) => (
                                    <span key={`f-${i}`} className="inline-flex items-center gap-1 bg-secondary/80 border border-border rounded-md px-2 py-0.5 text-xs text-muted-foreground">
                                      <FileText className="h-3 w-3 shrink-0" />
                                      <span className="truncate max-w-[180px]">{name}</span>
                                    </span>
                                  ))}
                                  {pdfAttachments.map((a, i) => (
                                    <span key={`p-${i}`} className="inline-flex items-center gap-1 bg-red-500/10 border border-red-500/30 rounded-md px-2 py-0.5 text-xs text-red-400">
                                      <FileText className="h-3 w-3 shrink-0" />
                                      <span className="truncate max-w-[180px]">{a.name}</span>
                                    </span>
                                  ))}
                                  {imageAttachments.map((a, i) => (
                                    <span key={`i-${i}`} className="inline-flex items-center gap-1 bg-blue-500/10 border border-blue-500/30 rounded-md px-2 py-0.5 text-xs text-blue-400">
                                      <ImageIcon className="h-3 w-3 shrink-0" />
                                      <span className="truncate max-w-[180px]">{a.name}</span>
                                    </span>
                                  ))}
                                </div>
                              )}
                              {displayText && (
                                <div className="bg-secondary text-secondary-foreground rounded-lg px-4 py-2 w-fit ml-auto">
                                  <Markdown>{displayText}</Markdown>
                                </div>
                              )}
                              {msg.timestamp && (
                                <div className="text-[10px] text-muted-foreground/60 text-right mr-1">
                                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        {msg.type === "assistant_stream" && (
                          <div className="group/msg relative max-w-full md:max-w-3/4 bg-card border border-border rounded-lg px-4 py-2">
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
                        {msg.type === "pending_user" && (() => {
                          const pendingEntries = selectedConversation.filter((m) => m.type === "pending_user");
                          const pendingIdx = pendingEntries.indexOf(msg);
                          const queuePos = pendingIdx + 1;
                          const totalPending = pendingEntries.length;
                          const pendingFileRegex = /<file\s+path="([^"]*)">\n[\s\S]*?\n<\/file>\n?/g;
                          const pendingFileNames = [];
                          let pendingMatch;
                          while ((pendingMatch = pendingFileRegex.exec(msg.text)) !== null) {
                            pendingFileNames.push(pendingMatch[1]);
                          }
                          const pendingDisplayText = msg.text.replace(/<file\s+path="[^"]*">\n[\s\S]*?\n<\/file>\n?/g, "").trim();
                          const pendingImageAttachments = (msg.attachments || []).filter((a) => a.type === "image");
                          const pendingPdfAttachments = (msg.attachments || []).filter((a) => a.type === "pdf");
                          const hasPendingChips = pendingFileNames.length > 0 || pendingImageAttachments.length > 0 || pendingPdfAttachments.length > 0;
                          return (
                            <div className="max-w-full md:max-w-lg ml-auto">
                              {hasPendingChips && (
                                <div className="flex flex-wrap gap-1 justify-end mb-1">
                                  {pendingFileNames.map((name, i) => (
                                    <span key={`f-${i}`} className="inline-flex items-center gap-1 bg-secondary/40 border border-dashed border-secondary-foreground/20 rounded-md px-2 py-0.5 text-xs text-muted-foreground">
                                      <FileText className="h-3 w-3 shrink-0" />
                                      <span className="truncate max-w-[180px]">{name}</span>
                                    </span>
                                  ))}
                                  {pendingPdfAttachments.map((a, i) => (
                                    <span key={`p-${i}`} className="inline-flex items-center gap-1 bg-red-500/10 border border-dashed border-red-500/30 rounded-md px-2 py-0.5 text-xs text-red-400/70">
                                      <FileText className="h-3 w-3 shrink-0" />
                                      <span className="truncate max-w-[180px]">{a.name}</span>
                                    </span>
                                  ))}
                                  {pendingImageAttachments.map((a, i) => (
                                    <span key={`i-${i}`} className="inline-flex items-center gap-1 bg-blue-500/10 border border-dashed border-blue-500/30 rounded-md px-2 py-0.5 text-xs text-blue-400/70">
                                      <ImageIcon className="h-3 w-3 shrink-0" />
                                      <span className="truncate max-w-[180px]">{a.name}</span>
                                    </span>
                                  ))}
                                </div>
                              )}
                              {pendingDisplayText && (
                                <div
                                  className="bg-secondary/60 text-secondary-foreground rounded-lg px-4 py-2 w-fit ml-auto border border-dashed border-secondary-foreground/20"
                                >
                                  <Markdown>{pendingDisplayText}</Markdown>
                                </div>
                              )}
                              <div className="flex items-center justify-end gap-2 mt-1">
                                <Clock className="h-3 w-3 text-muted-foreground animate-pulse" />
                                <span className="text-[11px] text-muted-foreground">
                                  Queued{totalPending > 1 ? ` (${queuePos}/${totalPending})` : ""} — will send when agent finishes
                                </span>
                                <button
                                  onClick={() => handleCancelPending(pendingIdx)}
                                  className="text-[11px] text-destructive hover:text-destructive/80 flex items-center gap-0.5 transition-colors"
                                >
                                  <X className="h-3 w-3" />
                                  Cancel
                                </button>
                              </div>
                            </div>
                          );
                        })()}
                        {msg.type === "error" && <ErrorCard error={msg} />}
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </ScrollArea>
                {showScrollDown && (
                  <button
                    onClick={handleScrollToBottom}
                    className="absolute bottom-28 right-6 z-10 flex items-center justify-center h-8 w-8 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-all animate-in fade-in slide-in-from-bottom-2 duration-200"
                    title="Scroll to bottom"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </button>
                )}
                <SuggestionBar suggestions={activeSuggestions} actions={activeActions} onSelect={handleSuggestionSelect} onAction={(a) => handleSuggestionAction(a.resolvedValue)} onManage={() => setSuggestionManagerOpen(true)} />
                <ChatInput key={selectedAgentId} onSend={handleSend} onStop={handleStop} onClearContext={handleClearContext} onDeleteHistory={handleDeleteHistory} onReconnect={reconnect} connected={connected} isBusy={agents.find((a) => a.id === selectedAgentId)?.status === "busy"} interactiveQuestions={!!interactiveQuestions[selectedAgentId]} onToggleQuestions={handleToggleInteractiveQuestions} model={agentModels[selectedAgentId] || ""} onSetModel={handleSetModel} modelOptions={modelOptions} draftText={drafts[selectedAgentId]?.text || ""} draftFiles={drafts[selectedAgentId]?.attachedFiles || []} onDraftChange={(text, files) => setDrafts((prev) => ({ ...prev, [selectedAgentId]: { text, attachedFiles: files } }))} />
              </div>
            )}
            {editorOpen && (
              <div className="flex-1 min-h-0">
                <CodeEditor agentId={selectedAgentId} visible={editorOpen} />
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
      <SuggestionManager
        open={suggestionManagerOpen}
        onClose={() => setSuggestionManagerOpen(false)}
        suggestions={allSuggestions}
        onCreate={createSugg}
        onUpdate={updateSugg}
        onDelete={deleteSugg}
        onReorder={reorderSuggs}
      />
    </div>
  );
}

function ChatInput({ onSend, onStop, onClearContext, onDeleteHistory, onReconnect, connected, isBusy, interactiveQuestions, onToggleQuestions, model, onSetModel, modelOptions = [], draftText = "", draftFiles = [], onDraftChange }) {
  const [text, setText] = useState(draftText);
  const [attachedFiles, setAttachedFiles] = useState(draftFiles);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  // Persist drafts back to parent on unmount (agent switch) or when text/files change
  const draftRef = useRef({ text, attachedFiles });
  draftRef.current = { text, attachedFiles };

  useEffect(() => {
    // Save draft on unmount (when switching away from this agent)
    return () => {
      if (onDraftChange) {
        onDraftChange(draftRef.current.text, draftRef.current.attachedFiles);
      }
    };
  }, []);

  // Resize textarea on mount to fit restored draft
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta && text) {
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    }
  }, []);

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
    const hasFiles = attachedFiles.length > 0;
    const hasText = text.trim().length > 0;
    if (!hasFiles && !hasText) return;

    const textFiles = attachedFiles.filter((f) => f.type === "text");
    const imageFiles = attachedFiles.filter((f) => f.type === "image");
    const pdfFiles = attachedFiles.filter((f) => f.type === "pdf");

    // Build text portion: text files use XML format (as before), then user text
    let message = "";
    if (textFiles.length > 0) {
      const fileParts = textFiles.map(
        (f) => `<file path="${f.name.replace(/"/g, '&quot;')}">\n${f.content}\n</file>`
      );
      message = fileParts.join("\n") + "\n";
    }
    if (hasText) {
      message += text;
    }

    // Build attachments array for images and PDFs (sent as SDK content blocks server-side)
    const attachments = [
      ...imageFiles.map((f) => ({
        name: f.name,
        type: "image",
        mediaType: f.mediaType,
        data: f.data,
      })),
      ...pdfFiles.map((f) => ({
        name: f.name,
        type: "pdf",
        mediaType: f.mediaType,
        data: f.data,
      })),
    ];

    if (attachments.length > 0) {
      onSend(message, attachments);
    } else {
      onSend(message);
    }

    setText("");
    setAttachedFiles([]);
    // Clear draft immediately so it's gone when coming back to this chat
    if (onDraftChange) onDraftChange("", []);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleFileSelect(e) {
    const IMAGE_MIME_TYPES = { "image/jpeg": true, "image/png": true, "image/gif": true, "image/webp": true };
    const IMAGE_EXTENSIONS = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };
    // Known binary extensions that can't be meaningfully read as text
    const BINARY_EXTENSIONS = new Set([
      "zip", "tar", "gz", "bz2", "7z", "rar", "xz",
      "exe", "dll", "so", "dylib", "bin",
      "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp",
      "mp3", "mp4", "avi", "mov", "mkv", "flac", "wav", "ogg", "m4a",
      "ttf", "otf", "woff", "woff2", "eot",
      "sqlite", "db", "iso", "dmg", "deb", "rpm",
      "class", "pyc", "pyo", "o", "a", "lib",
    ]);

    function getImageMediaType(file) {
      if (IMAGE_MIME_TYPES[file.type]) return file.type;
      const ext = file.name.split(".").pop()?.toLowerCase();
      return (ext && IMAGE_EXTENSIONS[ext]) || null;
    }

    function isPdf(file) {
      if (file.type === "application/pdf") return true;
      const ext = file.name.split(".").pop()?.toLowerCase();
      return ext === "pdf";
    }

    function isBinaryFile(file) {
      const ext = file.name.split(".").pop()?.toLowerCase();
      return ext && BINARY_EXTENSIONS.has(ext);
    }

    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    Promise.all(
      files.map((file) => {
        return new Promise((resolve) => {
          const mediaType = getImageMediaType(file);

          if (mediaType) {
            // Image file — read as base64 for native Claude vision support
            if (file.size > 5 * 1024 * 1024) {
              resolve({ name: file.name, type: "error", error: "Image exceeds 5MB limit" });
              return;
            }
            const reader = new FileReader();
            reader.onload = () => {
              const dataUrl = reader.result;
              const base64 = dataUrl.split(",")[1];
              resolve({ name: file.name, type: "image", mediaType, data: base64, dataUrl });
            };
            reader.onerror = () => {
              resolve({ name: file.name, type: "error", error: "Could not read image" });
            };
            reader.readAsDataURL(file);
          } else if (isPdf(file)) {
            // PDF file — read as base64 for native Claude document support
            if (file.size > 32 * 1024 * 1024) {
              resolve({ name: file.name, type: "error", error: "PDF exceeds 32MB limit" });
              return;
            }
            const reader = new FileReader();
            reader.onload = () => {
              const dataUrl = reader.result;
              const base64 = dataUrl.split(",")[1];
              resolve({ name: file.name, type: "pdf", mediaType: "application/pdf", data: base64 });
            };
            reader.onerror = () => {
              resolve({ name: file.name, type: "error", error: "Could not read PDF" });
            };
            reader.readAsDataURL(file);
          } else if (isBinaryFile(file)) {
            // Known binary file — cannot be sent to Claude
            resolve({ name: file.name, type: "error", error: "Binary files are not supported. Use text, image, or PDF files." });
          } else {
            // Text-like file — read as text (code, config, logs, etc.)
            const reader = new FileReader();
            reader.onload = () => {
              resolve({ name: file.name, type: "text", content: reader.result });
            };
            reader.onerror = () => {
              resolve({ name: file.name, type: "error", error: "Could not read file" });
            };
            reader.readAsText(file);
          }
        });
      })
    ).then((newFiles) => {
      const valid = newFiles.filter((f) => f.type !== "error");
      const errors = newFiles.filter((f) => f.type === "error");
      if (errors.length > 0) {
        console.warn("Skipped files:", errors.map((e) => `${e.name}: ${e.error}`));
      }
      setAttachedFiles((prev) => [...prev, ...valid]);
    });

    e.target.value = "";
  }

  function removeFile(index) {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  // Close model menu on click outside
  useEffect(() => {
    if (!modelMenuOpen) return;
    function handleClickOutside(e) {
      // Check if click is inside any model menu container (desktop or mobile)
      if (e.target.closest("[data-model-menu]")) return;
      setModelMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [modelMenuOpen]);

  return (
    <form onSubmit={handleSubmit} className="p-4 border-t border-border bg-background sticky bottom-0 z-10">
      {/* Input row: textarea + send button, full width */}
      <div className="flex gap-2 items-end">
        {/* Icons inline on desktop */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClearContext}
          disabled={!connected}
          title="Clear context"
          className="text-muted-foreground hover:text-yellow-500 shrink-0 hidden md:inline-flex"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => { if (confirm("Delete entire chat history? This cannot be undone.")) onDeleteHistory(); }}
          disabled={!connected}
          title="Delete chat history"
          className="text-muted-foreground hover:text-red-500 shrink-0 hidden md:inline-flex"
        >
          <Eraser className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onToggleQuestions}
          title={interactiveQuestions ? "Questions: interactive (click to auto-answer)" : "Questions: auto-answer (click to make interactive)"}
          className={cn("shrink-0 hidden md:inline-flex", interactiveQuestions ? "text-primary" : "text-muted-foreground hover:text-foreground")}
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
          className="text-muted-foreground hover:text-foreground shrink-0 hidden md:inline-flex"
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <div className="relative hidden md:block shrink-0" data-model-menu>
          <button
            type="button"
            onClick={() => setModelMenuOpen((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1 px-2 py-1.5 text-xs rounded-md transition-colors",
              model
                ? "text-primary bg-primary/10 hover:bg-primary/15"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
            title="Select model"
          >
            <Cpu className="h-3.5 w-3.5" />
            <span className="max-w-[80px] truncate">{getModelShortLabel(model)}</span>
            <ChevronDown className="h-3 w-3" />
          </button>
          {modelMenuOpen && (
            <div className="absolute bottom-full mb-1 left-0 w-56 bg-popover border border-border rounded-lg shadow-lg py-1 z-50">
              <button
                type="button"
                onClick={() => { onSetModel(""); setModelMenuOpen(false); }}
                className={cn(
                  "w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center justify-between",
                  !model && "text-primary font-medium"
                )}
              >
                <span>
                  <span className="font-medium">Default</span>
                  <span className="block text-muted-foreground/70 text-[11px]">Uses Claude settings default</span>
                </span>
                {!model && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
              </button>
              {modelOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { onSetModel(opt.value); setModelMenuOpen(false); }}
                  className={cn(
                    "w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center justify-between",
                    model === opt.value && "text-primary font-medium"
                  )}
                >
                  <span>
                    <span className="font-medium">{opt.label}</span>
                    <span className="block text-muted-foreground/70 text-[11px]">{opt.description}</span>
                  </span>
                  {model === opt.value && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
        <div className="flex-1 flex flex-col min-w-0">
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 py-2 border border-input border-b-0 rounded-t-md bg-muted/30">
              {attachedFiles.map((file, idx) => (
                <Badge
                  key={idx}
                  variant="secondary"
                  className={cn("gap-1 pl-1.5 pr-1 py-0.5 max-w-[200px] cursor-default", file.type === "image" && "border-blue-500/30", file.type === "pdf" && "border-red-500/30")}
                >
                  {file.type === "image" ? (
                    <img src={file.dataUrl} alt={file.name} className="h-5 w-5 rounded-sm object-cover shrink-0" />
                  ) : (
                    <FileText className="h-3 w-3 shrink-0" />
                  )}
                  <span className="truncate text-xs">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => removeFile(idx)}
                    className="ml-0.5 rounded-sm hover:bg-foreground/10 p-0.5 shrink-0"
                    title={`Remove ${file.name}`}
                    aria-label={`Remove ${file.name}`}
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={!connected ? "Connecting..." : isBusy ? "Type a message to queue..." : "Send a message..."}
            disabled={!connected}
            rows={1}
            className={cn(
              "w-full resize-none overflow-y-auto border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
              attachedFiles.length > 0 ? "rounded-b-md rounded-t-none border-t-0" : "rounded-md"
            )}
            style={{ maxHeight: "25vh" }}
          />
        </div>
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
        ) : (
          <div className="flex gap-1 shrink-0">
            {isBusy && (
              <Button
                type="button"
                variant="destructive"
                size="icon"
                onClick={onStop}
                title="Stop agent"
              >
                <Square className="h-4 w-4" />
              </Button>
            )}
            <Button
              type="submit"
              disabled={!text.trim() && attachedFiles.length === 0}
              size="icon"
              title={isBusy ? "Queue message (will send when agent finishes)" : "Send message"}
              className={isBusy ? "bg-primary/70 hover:bg-primary/80" : ""}
            >
              {isBusy ? <Clock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        )}
      </div>
      {/* Icons row on mobile */}
      <div className="flex gap-1 mt-2 md:hidden">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClearContext}
          disabled={!connected}
          title="Clear context"
          className="text-muted-foreground hover:text-yellow-500 h-8 w-8"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => { if (confirm("Delete entire chat history? This cannot be undone.")) onDeleteHistory(); }}
          disabled={!connected}
          title="Delete chat history"
          className="text-muted-foreground hover:text-red-500 h-8 w-8"
        >
          <Eraser className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onToggleQuestions}
          title={interactiveQuestions ? "Questions: interactive (click to auto-answer)" : "Questions: auto-answer (click to make interactive)"}
          className={cn("h-8 w-8", interactiveQuestions ? "text-primary" : "text-muted-foreground hover:text-foreground")}
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
          className="text-muted-foreground hover:text-foreground h-8 w-8"
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <div className="relative ml-auto" data-model-menu>
          <button
            type="button"
            onClick={() => setModelMenuOpen((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors",
              model
                ? "text-primary bg-primary/10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            <Cpu className="h-3.5 w-3.5" />
            <span className="max-w-[80px] truncate">{getModelShortLabel(model)}</span>
            <ChevronDown className="h-3 w-3" />
          </button>
          {modelMenuOpen && (
            <div className="absolute bottom-full mb-1 right-0 w-56 bg-popover border border-border rounded-lg shadow-lg py-1 z-50">
              <button
                type="button"
                onClick={() => { onSetModel(""); setModelMenuOpen(false); }}
                className={cn(
                  "w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center justify-between",
                  !model && "text-primary font-medium"
                )}
              >
                <span>
                  <span className="font-medium">Default</span>
                  <span className="block text-muted-foreground/70 text-[11px]">Uses Claude settings default</span>
                </span>
                {!model && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
              </button>
              {modelOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { onSetModel(opt.value); setModelMenuOpen(false); }}
                  className={cn(
                    "w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center justify-between",
                    model === opt.value && "text-primary font-medium"
                  )}
                >
                  <span>
                    <span className="font-medium">{opt.label}</span>
                    <span className="block text-muted-foreground/70 text-[11px]">{opt.description}</span>
                  </span>
                  {model === opt.value && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </form>
  );
}
