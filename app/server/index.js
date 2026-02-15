import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
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
  const normalized = path.normalize(workingDirectory).replace(/\/+$/, "");
  if (normalized === "/workspace" || !normalized.startsWith("/workspace/")) {
    return res.status(400).json({ error: "workingDirectory must be a subfolder of /workspace (e.g. /workspace/my-project)" });
  }
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

// SPA fallback (Express 5 requires named wildcard)
app.get("{*path}", (_req, res) => {
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
