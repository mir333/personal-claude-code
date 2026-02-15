import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import crypto from "crypto";
import session from "express-session";
import {
  createAgent,
  listAgents,
  getAgent,
  deleteAgent,
  getHistory,
  clearContext,
  sendMessage,
} from "./agents.js";
import { getUsageStats } from "./usage.js";
import {
  spawnTerminal,
  getTerminal,
  killTerminal,
  resizeTerminal,
  killAllTerminals,
} from "./terminals.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);
const bootId = crypto.randomUUID();

const AUTH_PASSWORD = process.env.AUTH_PASSWORD;

app.use(express.json());

// Session middleware (needed for auth and WebSocket session lookup)
const sessionMiddleware = session({
  secret: AUTH_PASSWORD ? crypto.createHash("sha256").update(AUTH_PASSWORD).digest("hex") : crypto.randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 1 week
  },
});
app.use(sessionMiddleware);

// Auth routes (always mounted so client can check)
app.post("/api/auth/login", (req, res) => {
  if (!AUTH_PASSWORD) {
    return res.json({ authenticated: true });
  }
  if (req.body.password === AUTH_PASSWORD) {
    req.session.authenticated = true;
    return res.json({ authenticated: true });
  }
  res.status(401).json({ error: "Wrong password" });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/api/auth/check", (req, res) => {
  if (!AUTH_PASSWORD) {
    return res.json({ authenticated: true });
  }
  res.json({ authenticated: req.session.authenticated === true });
});

// Auth guard middleware
function requireAuth(req, res, next) {
  if (!AUTH_PASSWORD) return next();
  if (req.session.authenticated) return next();

  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  // For page requests, let the SPA handle the redirect
  return res.status(401).json({ error: "Unauthorized" });
}

// Apply auth guard to all API routes (except auth endpoints above)
app.use("/api", requireAuth);

// Serve static frontend — auth guard for HTML pages
app.use((req, res, next) => {
  if (!AUTH_PASSWORD) return next();
  if (req.session.authenticated) return next();
  // Allow static assets (JS, CSS, images) so the login page can load
  if (/\.(js|css|png|jpg|jpeg|svg|ico|woff2?|ttf|eot|map)(\?|$)/.test(req.path)) {
    return next();
  }
  // For HTML page requests, serve index.html (the SPA will show login)
  next();
});

app.use(express.static(path.join(__dirname, "..", "dist")));

// REST API
app.post("/api/agents", (req, res) => {
  const { name, workingDirectory } = req.body;
  if (!name || !workingDirectory) {
    return res.status(400).json({ error: "name and workingDirectory are required" });
  }
  const normalized = path.normalize(workingDirectory).replace(/\/+$/, "");
  if (normalized === "/workspace" || !normalized.startsWith("/workspace/")) {
    return res.status(400).json({ error: "workingDirectory must be a subfolder of /workspace (e.g. /workspace/my-project)" });
  }
  // Ensure the workspace directory exists
  fs.mkdirSync(normalized, { recursive: true });
  const agent = createAgent(name, normalized);
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

app.get("/api/workspace", async (_req, res) => {
  try {
    const entries = await fs.promises.readdir("/workspace", { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => ({ name: e.name, path: `/workspace/${e.name}` }));
    res.json(dirs);
  } catch {
    res.json([]);
  }
});

app.get("/api/usage", (_req, res) => {
  res.json(getUsageStats());
});

app.post("/api/agents/:id/clear-context", (req, res) => {
  const ok = clearContext(req.params.id);
  if (!ok) return res.status(404).json({ error: "Agent not found" });
  res.json({ ok: true });
});

app.get("/api/agents/:id/history", (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  const history = getHistory(req.params.id);
  res.json(history);
});

function gitExec(args, cwd) {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: 5000 }, (err, stdout) => {
      if (err) resolve(null);
      else resolve(stdout.trim());
    });
  });
}

app.get("/api/agents/:id/git-status", async (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });

  const cwd = agent.workingDirectory;

  // Check if it's a git repo
  const topLevel = await gitExec(["rev-parse", "--show-toplevel"], cwd);
  if (topLevel === null) {
    return res.json({ isRepo: false });
  }

  const [branch, status, ahead] = await Promise.all([
    gitExec(["rev-parse", "--abbrev-ref", "HEAD"], cwd),
    gitExec(["status", "--porcelain"], cwd),
    gitExec(["rev-list", "--count", "@{upstream}..HEAD"], cwd),
  ]);

  const dirty = status !== null && status.length > 0;
  const unpushed = ahead !== null ? parseInt(ahead, 10) : 0;

  // "dirty" = uncommitted changes, "ahead" = committed but not pushed, "clean" = all pushed
  let state = "clean";
  if (dirty) state = "dirty";
  else if (unpushed > 0) state = "ahead";

  res.json({ isRepo: true, branch: branch || "unknown", state, unpushed });
});

// SPA fallback (Express 5 requires named wildcard)
app.get("{*path}", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "dist", "index.html"));
});

// WebSocket
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  // Parse session from the upgrade request
  sessionMiddleware(request, {}, () => {
    if (AUTH_PASSWORD && !request.session?.authenticated) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });
});

wss.on("connection", (ws) => {
  const connectionTerminals = new Set(); // track terminals opened by this connection

  // Send boot ID so clients can detect server restarts
  ws.send(JSON.stringify({ type: "welcome", bootId }));

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
    } else if (data.type === "terminal_start" && data.agentId) {
      const agent = getAgent(data.agentId);
      if (!agent) {
        ws.send(JSON.stringify({ type: "error", message: "Agent not found" }));
        return;
      }
      const term = spawnTerminal(data.agentId, agent.workingDirectory);
      connectionTerminals.add(data.agentId);
      term.onData((output) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: "terminal_output", agentId: data.agentId, data: output }));
        }
      });
    } else if (data.type === "terminal_input" && data.agentId && data.data) {
      const term = getTerminal(data.agentId);
      if (term) term.write(data.data);
    } else if (data.type === "terminal_resize" && data.agentId && data.cols && data.rows) {
      resizeTerminal(data.agentId, data.cols, data.rows);
    } else if (data.type === "terminal_stop" && data.agentId) {
      killTerminal(data.agentId);
      connectionTerminals.delete(data.agentId);
    }
  });

  ws.on("close", () => {
    killAllTerminals(connectionTerminals);
    connectionTerminals.clear();
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Claude Web UI running on http://0.0.0.0:${PORT}`);
});
