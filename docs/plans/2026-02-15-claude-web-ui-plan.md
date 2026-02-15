# Claude Code Web UI — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a React + Node.js web app inside the Claude Code container that lets users manage and chat with multiple Claude Code agents via the browser.

**Architecture:** Node.js backend using Express + ws (WebSocket) + Claude Agent SDK manages agent sessions. React 19 frontend with Tailwind CSS v4 provides a sidebar+chat UI. Backend serves the built frontend as static files on port 3001.

**Tech Stack:** React 19, Vite, Tailwind CSS v4, Node.js, Express, ws, @anthropic-ai/claude-agent-sdk

---

### Task 1: Initialize project structure and dependencies

**Files:**
- Create: `app/package.json`
- Create: `app/client/index.html`
- Create: `app/client/vite.config.js`
- Create: `app/client/src/index.css`
- Create: `app/client/src/main.jsx`
- Create: `app/client/src/App.jsx`

**Step 1: Create app directory structure**

```bash
mkdir -p app/server app/client/src/components
```

**Step 2: Create package.json**

Create `app/package.json`:
```json
{
  "name": "claude-web-ui",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev:client": "vite --config client/vite.config.js",
    "dev:server": "node server/index.js",
    "build": "vite build --config client/vite.config.js",
    "start": "node server/index.js"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.1.0",
    "express": "^5.0.0",
    "uuid": "^11.0.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwindcss": "^4.0.0",
    "vite": "^6.0.0"
  }
}
```

**Step 3: Create vite.config.js**

Create `app/client/vite.config.js`:
```javascript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "client",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    proxy: {
      "/api": "http://localhost:3001",
      "/ws": {
        target: "ws://localhost:3001",
        ws: true,
      },
    },
  },
});
```

**Step 4: Create index.html**

Create `app/client/index.html`:
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Claude Code Web UI</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

**Step 5: Create CSS entry point**

Create `app/client/src/index.css`:
```css
@import "tailwindcss";
```

**Step 6: Create React entry point**

Create `app/client/src/main.jsx`:
```jsx
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(<App />);
```

Create `app/client/src/App.jsx`:
```jsx
export default function App() {
  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      <div className="w-72 border-r border-gray-800 p-4">Sidebar</div>
      <div className="flex-1 p-4">Chat Panel</div>
    </div>
  );
}
```

**Step 7: Install dependencies and verify**

```bash
cd /data/git/mir333/claude-container/app && npm install
cd /data/git/mir333/claude-container/app && npx vite build --config client/vite.config.js
```

Expected: Build completes with output in `app/dist/`.

**Step 8: Commit**

```bash
git add app/
git commit -m "feat: initialize web UI project with React 19, Vite, Tailwind v4"
```

---

### Task 2: Build the backend — Express server + agent management

**Files:**
- Create: `app/server/index.js`
- Create: `app/server/agents.js`

**Step 1: Create agent management module**

Create `app/server/agents.js`:
```javascript
import { query } from "@anthropic-ai/claude-agent-sdk";
import { v4 as uuidv4 } from "uuid";

const agents = new Map();

export function createAgent(name, workingDirectory) {
  const id = uuidv4();
  const agent = {
    id,
    name,
    workingDirectory,
    status: "idle",
    history: [],
    sessionId: null,
    abortController: null,
  };
  agents.set(id, agent);
  return agent;
}

export function getAgent(id) {
  return agents.get(id);
}

export function listAgents() {
  return Array.from(agents.values()).map(({ id, name, workingDirectory, status }) => ({
    id,
    name,
    workingDirectory,
    status,
  }));
}

export function deleteAgent(id) {
  const agent = agents.get(id);
  if (!agent) return false;
  if (agent.abortController) {
    agent.abortController.abort();
  }
  agents.delete(id);
  return true;
}

export function getHistory(id) {
  const agent = agents.get(id);
  if (!agent) return null;
  return agent.history;
}

export async function sendMessage(id, text, onEvent) {
  const agent = agents.get(id);
  if (!agent) throw new Error("Agent not found");
  if (agent.status === "busy") throw new Error("Agent is busy");

  agent.status = "busy";
  agent.history.push({ role: "user", content: text, timestamp: Date.now() });

  const abortController = new AbortController();
  agent.abortController = abortController;

  try {
    const options = {
      cwd: agent.workingDirectory,
      permissionMode: "acceptEdits",
      includePartialMessages: true,
      abortSignal: abortController.signal,
    };

    if (agent.sessionId) {
      options.resume = agent.sessionId;
    }

    for await (const message of query({ prompt: text, options })) {
      if (abortController.signal.aborted) break;

      // Capture session ID
      if (message.type === "system" && message.subtype === "init") {
        agent.sessionId = message.session_id;
      }

      // Stream text deltas
      if (message.type === "stream_event") {
        const event = message.event;
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
          onEvent({ type: "text_delta", text: event.delta.text });
        }
      }

      // Complete assistant message with tool calls
      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "tool_use") {
            onEvent({
              type: "tool_call",
              tool: block.name,
              input: block.input,
              toolUseId: block.id,
            });
          }
        }
      }

      // Tool results
      if (message.type === "user") {
        for (const block of message.message.content) {
          if (block.type === "tool_result") {
            onEvent({
              type: "tool_result",
              toolUseId: block.tool_use_id,
              output: typeof block.content === "string"
                ? block.content
                : JSON.stringify(block.content),
            });
          }
        }
      }

      // Final result
      if (message.type === "result") {
        const resultText = message.result || "";
        agent.history.push({
          role: "assistant",
          content: resultText,
          timestamp: Date.now(),
        });
        onEvent({ type: "done", result: resultText, cost: message.total_cost_usd });
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      agent.status = "error";
      onEvent({ type: "error", message: err.message });
      return;
    }
  } finally {
    agent.abortController = null;
    if (agent.status === "busy") agent.status = "idle";
  }
}
```

**Step 2: Create Express + WebSocket server**

Create `app/server/index.js`:
```javascript
import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import {
  createAgent,
  listAgents,
  getAgent,
  deleteAgent,
  getHistory,
  sendMessage,
} from "./agents.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);

app.use(express.json());

// Serve static frontend
app.use(express.static(path.join(__dirname, "..", "dist")));

// REST API
app.post("/api/agents", (req, res) => {
  const { name, workingDirectory } = req.body;
  if (!name || !workingDirectory) {
    return res.status(400).json({ error: "name and workingDirectory are required" });
  }
  const agent = createAgent(name, workingDirectory);
  res.status(201).json(agent);
});

app.get("/api/agents", (_req, res) => {
  res.json(listAgents());
});

app.get("/api/agents/:id", (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  const { id, name, workingDirectory, status } = agent;
  res.json({ id, name, workingDirectory, status });
});

app.delete("/api/agents/:id", (req, res) => {
  const deleted = deleteAgent(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Agent not found" });
  res.status(204).end();
});

app.get("/api/agents/:id/history", (req, res) => {
  const history = getHistory(req.params.id);
  if (!history) return res.status(404).json({ error: "Agent not found" });
  res.json(history);
});

// SPA fallback
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "dist", "index.html"));
});

// WebSocket
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  ws.on("message", async (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
      return;
    }

    if (data.type === "message" && data.agentId && data.text) {
      try {
        await sendMessage(data.agentId, data.text, (event) => {
          ws.send(JSON.stringify({ ...event, agentId: data.agentId }));
        });
      } catch (err) {
        ws.send(
          JSON.stringify({ type: "error", agentId: data.agentId, message: err.message })
        );
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Claude Web UI running on http://0.0.0.0:${PORT}`);
});
```

**Step 3: Verify server starts without errors**

```bash
cd /data/git/mir333/claude-container/app && node --check server/index.js && node --check server/agents.js
```

Expected: No syntax errors.

**Step 4: Commit**

```bash
git add app/server/
git commit -m "feat: add Express + WebSocket backend with Claude SDK agent management"
```

---

### Task 3: Build the frontend — Sidebar component

**Files:**
- Create: `app/client/src/hooks/useWebSocket.js`
- Create: `app/client/src/hooks/useAgents.js`
- Create: `app/client/src/components/Sidebar.jsx`
- Create: `app/client/src/components/NewAgentForm.jsx`
- Modify: `app/client/src/App.jsx`

**Step 1: Create WebSocket hook**

Create `app/client/src/hooks/useWebSocket.js`:
```javascript
import { useEffect, useRef, useCallback, useState } from "react";

export function useWebSocket(onMessage) {
  const wsRef = useRef(null);
  const onMessageRef = useRef(onMessage);
  const [connected, setConnected] = useState(false);
  onMessageRef.current = onMessage;

  useEffect(() => {
    let ws;
    let reconnectTimer;

    function connect() {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        reconnectTimer = setTimeout(connect, 2000);
      };
      ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        onMessageRef.current(data);
      };
    }

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  const send = useCallback((data) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { send, connected };
}
```

**Step 2: Create agents hook**

Create `app/client/src/hooks/useAgents.js`:
```javascript
import { useState, useCallback } from "react";

export function useAgents() {
  const [agents, setAgents] = useState([]);

  const fetchAgents = useCallback(async () => {
    const res = await fetch("/api/agents");
    setAgents(await res.json());
  }, []);

  const createAgent = useCallback(async (name, workingDirectory) => {
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, workingDirectory }),
    });
    const agent = await res.json();
    setAgents((prev) => [...prev, agent]);
    return agent;
  }, []);

  const removeAgent = useCallback(async (id) => {
    await fetch(`/api/agents/${id}`, { method: "DELETE" });
    setAgents((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const updateAgentStatus = useCallback((id, status) => {
    setAgents((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status } : a))
    );
  }, []);

  return { agents, fetchAgents, createAgent, removeAgent, updateAgentStatus };
}
```

**Step 3: Create NewAgentForm component**

Create `app/client/src/components/NewAgentForm.jsx`:
```jsx
import { useState } from "react";

export default function NewAgentForm({ onSubmit, onCancel }) {
  const [name, setName] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState("/workspace");

  function handleSubmit(e) {
    e.preventDefault();
    if (name.trim()) onSubmit(name.trim(), workingDirectory.trim());
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
```

**Step 4: Create Sidebar component**

Create `app/client/src/components/Sidebar.jsx`:
```jsx
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
```

**Step 5: Update App.jsx with sidebar wiring**

Replace `app/client/src/App.jsx`:
```jsx
import { useEffect, useState, useCallback } from "react";
import Sidebar from "./components/Sidebar.jsx";
import { useAgents } from "./hooks/useAgents.js";
import { useWebSocket } from "./hooks/useWebSocket.js";

export default function App() {
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const [conversations, setConversations] = useState({});
  const { agents, fetchAgents, createAgent, removeAgent, updateAgentStatus } = useAgents();

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
            <div className="flex-1 overflow-y-auto p-4">
              {selectedConversation.map((msg, i) => (
                <div key={i} className="mb-2 text-sm">
                  {msg.type === "user" && (
                    <div className="ml-auto max-w-lg bg-blue-600 rounded-lg px-4 py-2 w-fit ml-auto">{msg.text}</div>
                  )}
                  {msg.type === "assistant_stream" && (
                    <div className="max-w-2xl bg-gray-800 rounded-lg px-4 py-2 whitespace-pre-wrap">{msg.text}</div>
                  )}
                  {msg.type === "tool_call" && (
                    <div className="max-w-2xl text-xs text-gray-400 bg-gray-900 rounded px-3 py-1.5">
                      Tool: {msg.tool}
                    </div>
                  )}
                  {msg.type === "error" && (
                    <div className="max-w-2xl bg-red-900/50 text-red-300 rounded-lg px-4 py-2">{msg.message}</div>
                  )}
                </div>
              ))}
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
```

**Step 6: Verify build**

```bash
cd /data/git/mir333/claude-container/app && npx vite build --config client/vite.config.js
```

Expected: Build succeeds.

**Step 7: Commit**

```bash
git add app/client/
git commit -m "feat: add sidebar, chat panel, WebSocket and agent hooks"
```

---

### Task 4: Build the ToolCallCard component for collapsible tool calls

**Files:**
- Create: `app/client/src/components/ToolCallCard.jsx`
- Modify: `app/client/src/App.jsx` (update tool_call rendering)

**Step 1: Create ToolCallCard component**

Create `app/client/src/components/ToolCallCard.jsx`:
```jsx
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
```

**Step 2: Update App.jsx to use ToolCallCard and pair tool calls with results**

In `app/client/src/App.jsx`, replace the tool_call rendering block inside the message map. Replace:
```jsx
                  {msg.type === "tool_call" && (
                    <div className="max-w-2xl text-xs text-gray-400 bg-gray-900 rounded px-3 py-1.5">
                      Tool: {msg.tool}
                    </div>
                  )}
```
With:
```jsx
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
```

Add import at the top of App.jsx:
```jsx
import ToolCallCard from "./components/ToolCallCard.jsx";
```

**Step 3: Verify build**

```bash
cd /data/git/mir333/claude-container/app && npx vite build --config client/vite.config.js
```

**Step 4: Commit**

```bash
git add app/client/src/components/ToolCallCard.jsx app/client/src/App.jsx
git commit -m "feat: add collapsible tool call cards in chat"
```

---

### Task 5: Update Dockerfile and docker-compose

**Files:**
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`
- Create: `app/entrypoint.sh`

**Step 1: Create entrypoint script**

Create `app/entrypoint.sh`:
```bash
#!/bin/bash
echo "Starting Claude Web UI on port 3001..."
cd /app && node server/index.js &
echo "Web UI started. Access at http://localhost:3001"
echo "Container ready. Use 'docker exec' for terminal access."
exec sleep infinity
```

**Step 2: Update Dockerfile**

Add the following after the existing Claude Code install line (`RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}`), BEFORE the firewall section:

```dockerfile
# Install Claude Agent SDK globally for the web UI
RUN npm install -g @anthropic-ai/claude-agent-sdk

# Copy and build web UI app
COPY --chown=node:node app/ /app/
RUN cd /app && npm install && npm run build

# Copy entrypoint
COPY --chown=node:node app/entrypoint.sh /usr/local/bin/entrypoint.sh
```

Then in the firewall section, after `USER root`, add:
```dockerfile
RUN chmod +x /usr/local/bin/entrypoint.sh
```

**Step 3: Update docker-compose.yml**

Add port mapping and update command:

Under the `claude-code` service, add:
```yaml
    ports:
      - "3001:3001"
```

Replace the `command: sleep infinity` line with:
```yaml
    command: /usr/local/bin/entrypoint.sh
```

**Step 4: Commit**

```bash
git add Dockerfile docker-compose.yml app/entrypoint.sh
git commit -m "feat: update container to build and serve web UI on port 3001"
```

---

### Task 6: Add auto-scroll, connection indicator, and polish

**Files:**
- Modify: `app/client/src/App.jsx`

**Step 1: Add auto-scroll to chat**

In App.jsx, add a ref and scroll effect. Add after the state declarations:

```jsx
import { useEffect, useState, useCallback, useRef } from "react";

// Inside App component:
const messagesEndRef = useRef(null);

useEffect(() => {
  messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
}, [selectedConversation]);
```

Add `<div ref={messagesEndRef} />` at the end of the messages container, just before the closing `</div>` of the overflow-y-auto div.

**Step 2: Add connection status indicator**

Add a small dot in the header area showing WebSocket connection status. In the main content area header:

```jsx
{!connected && (
  <div className="px-4 py-1.5 bg-yellow-900/50 text-yellow-300 text-xs text-center">
    Reconnecting to server...
  </div>
)}
```

**Step 3: Verify build**

```bash
cd /data/git/mir333/claude-container/app && npx vite build --config client/vite.config.js
```

**Step 4: Commit**

```bash
git add app/client/
git commit -m "feat: add auto-scroll and connection status indicator"
```

---

### Task 7: Build and test the container end-to-end

**Step 1: Build the Docker image**

```bash
cd /data/git/mir333/claude-container && docker compose build
```

Expected: Image builds successfully with web UI compiled.

**Step 2: Start the container**

```bash
docker compose up -d
```

**Step 3: Verify the web UI is accessible**

```bash
curl -s http://localhost:3001 | head -5
```

Expected: HTML response with the React app.

**Step 4: Verify API endpoint works**

```bash
curl -s http://localhost:3001/api/agents
```

Expected: `[]` (empty array).

**Step 5: Test creating an agent**

```bash
curl -s -X POST http://localhost:3001/api/agents -H "Content-Type: application/json" -d '{"name":"test","workingDirectory":"/workspace"}'
```

Expected: JSON response with agent id, name, workingDirectory, status.

**Step 6: Commit any fixes**

If any issues found during testing, fix and commit.

```bash
git add -A
git commit -m "fix: address issues found during end-to-end testing"
```
