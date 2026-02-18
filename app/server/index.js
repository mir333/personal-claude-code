import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import crypto from "crypto";
import https from "https";
import session from "express-session";
import {
  createAgent,
  listAgents,
  getAgent,
  deleteAgent,
  abortAgent,
  getHistory,
  clearContext,
  sendMessage,
  setInteractiveQuestions,
  answerQuestion,
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

// Helper: read GitHub token and owner from stored credentials
function readGitToken() {
  try {
    const content = fs.readFileSync(GIT_CREDENTIALS_PATH, "utf-8");
    const match = content.match(/https:\/\/([^@]+)@github\.com/);
    if (match) return match[1];
  } catch {
    // file doesn't exist
  }
  return null;
}

function githubApi(method, apiPath, token, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname: "api.github.com",
        path: apiPath,
        method,
        headers: {
          Authorization: `token ${token}`,
          "User-Agent": "claude-container",
          Accept: "application/vnd.github.v3+json",
          ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(body) });
          } catch {
            resolve({ status: res.statusCode, data: body });
          }
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function execPromise(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

async function configureLocalGit(dir) {
  const [globalName, globalEmail] = await Promise.all([
    gitExec(["config", "--global", "--get", "user.name"], "/"),
    gitExec(["config", "--global", "--get", "user.email"], "/"),
  ]);
  if (globalName) await execPromise("git", ["config", "user.name", globalName], { cwd: dir });
  if (globalEmail) await execPromise("git", ["config", "user.email", globalEmail], { cwd: dir });
}

// REST API
app.post("/api/agents", async (req, res) => {
  const { name, workingDirectory, localOnly } = req.body;
  if (!name) {
    return res.status(400).json({ error: "name is required" });
  }

  // Mode 1: Existing directory (clicked from workspace list)
  if (workingDirectory) {
    const normalized = path.normalize(workingDirectory).replace(/\/+$/, "");
    if (normalized === "/workspace" || !normalized.startsWith("/workspace/")) {
      return res.status(400).json({ error: "workingDirectory must be a subfolder of /workspace (e.g. /workspace/my-project)" });
    }
    fs.mkdirSync(normalized, { recursive: true });
    const agent = createAgent(name, normalized);
    return res.status(201).json(agent);
  }

  // Mode 2: New project
  const slug = slugify(name);
  if (!slug) {
    return res.status(400).json({ error: "Name must contain at least one alphanumeric character" });
  }
  const projectDir = `/workspace/${slug}`;

  if (fs.existsSync(projectDir)) {
    return res.status(409).json({ error: `Directory /workspace/${slug} already exists` });
  }

  try {
    if (localOnly) {
      // Local-only: create dir + git init
      fs.mkdirSync(projectDir, { recursive: true });
      await execPromise("git", ["init"], { cwd: projectDir });
      await configureLocalGit(projectDir);
    } else {
      // GitHub mode: create repo via API, then clone
      const token = readGitToken();
      if (!token) {
        return res.status(400).json({ error: "GitHub token not configured. Set it in Git Settings." });
      }

      // Get GitHub username
      const userRes = await githubApi("GET", "/user", token);
      if (userRes.status !== 200) {
        return res.status(400).json({ error: "GitHub token is invalid or expired. Update it in Git Settings." });
      }
      const owner = userRes.data.login;

      // Create private repo
      const repoRes = await githubApi("POST", "/user/repos", token, { name: slug, private: true });
      if (repoRes.status === 422) {
        const msg = repoRes.data.errors?.[0]?.message || "Repository name already taken on GitHub";
        return res.status(409).json({ error: msg });
      }
      if (repoRes.status !== 201) {
        return res.status(502).json({ error: `GitHub API error: ${repoRes.data.message || "Unknown error"}` });
      }

      // Clone the repo
      const cloneUrl = `https://${token}@github.com/${owner}/${slug}.git`;
      await execPromise("git", ["clone", cloneUrl, slug], { cwd: "/workspace", timeout: 30000 });
      await configureLocalGit(projectDir);
    }

    const agent = createAgent(name, projectDir);
    res.status(201).json(agent);
  } catch (err) {
    // Clean up directory if it was partially created
    try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch {}
    res.status(500).json({ error: err.message || "Failed to create project" });
  }
});

app.get("/api/github/repos", async (_req, res) => {
  const token = readGitToken();
  if (!token) {
    return res.status(400).json({ error: "GitHub token not configured. Set it in Git Settings." });
  }
  try {
    // Fetch up to 100 repos, sorted by most recently updated
    const result = await githubApi("GET", "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member", token);
    if (result.status !== 200) {
      return res.status(400).json({ error: "GitHub token is invalid or expired. Update it in Git Settings." });
    }
    const repos = result.data.map((r) => ({
      full_name: r.full_name,
      name: r.name,
      private: r.private,
      description: r.description || "",
      updated_at: r.updated_at,
      owner: r.owner.login,
    }));
    res.json(repos);
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to fetch repos" });
  }
});

app.post("/api/agents/clone", async (req, res) => {
  const { repoFullName } = req.body;
  if (!repoFullName) {
    return res.status(400).json({ error: "repoFullName is required (e.g. owner/repo)" });
  }

  const token = readGitToken();
  if (!token) {
    return res.status(400).json({ error: "GitHub token not configured. Set it in Git Settings." });
  }

  const repoName = repoFullName.split("/").pop();
  const projectDir = `/workspace/${repoName}`;

  if (fs.existsSync(projectDir)) {
    return res.status(409).json({ error: `Directory /workspace/${repoName} already exists` });
  }

  try {
    const cloneUrl = `https://${token}@github.com/${repoFullName}.git`;
    await execPromise("git", ["clone", cloneUrl, repoName], { cwd: "/workspace", timeout: 60000 });
    await configureLocalGit(projectDir);
    const agent = createAgent(repoName, projectDir);
    res.status(201).json(agent);
  } catch (err) {
    try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch {}
    res.status(500).json({ error: err.message || "Failed to clone repository" });
  }
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

app.patch("/api/agents/:id/settings", (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  if (req.body.interactiveQuestions !== undefined) {
    setInteractiveQuestions(req.params.id, req.body.interactiveQuestions);
  }
  res.json({ interactiveQuestions: agent.interactiveQuestions });
});

// Git config endpoints — files live inside the persisted volume
const GIT_PERSIST_DIR = "/home/node/.claude/git";
const GIT_CONFIG_PATH = path.join(GIT_PERSIST_DIR, "gitconfig");
const GIT_CREDENTIALS_PATH = path.join(GIT_PERSIST_DIR, "git-credentials");
fs.mkdirSync(GIT_PERSIST_DIR, { recursive: true });
// Ensure the env var is set for this process and its children (SDK-spawned agents)
process.env.GIT_CONFIG_GLOBAL = GIT_CONFIG_PATH;

app.get("/api/git-config", async (_req, res) => {
  const [name, email] = await Promise.all([
    gitExec(["config", "--global", "--get", "user.name"], "/"),
    gitExec(["config", "--global", "--get", "user.email"], "/"),
  ]);

  let hasToken = false;
  try {
    const stat = await fs.promises.stat(GIT_CREDENTIALS_PATH);
    hasToken = stat.size > 0;
  } catch {
    // file doesn't exist
  }

  res.json({ name: name || "", email: email || "", hasToken });
});

app.post("/api/git-config", async (req, res) => {
  const { name, email, token } = req.body;

  if (name !== undefined) {
    await new Promise((resolve) =>
      execFile("git", ["config", "--global", "user.name", name], resolve)
    );
  }
  if (email !== undefined) {
    await new Promise((resolve) =>
      execFile("git", ["config", "--global", "user.email", email], resolve)
    );
  }
  if (token && token.trim()) {
    await fs.promises.writeFile(
      GIT_CREDENTIALS_PATH,
      `https://${token.trim()}@github.com\n`,
      { mode: 0o600 }
    );
  }

  // Return updated state
  const [updatedName, updatedEmail] = await Promise.all([
    gitExec(["config", "--global", "--get", "user.name"], "/"),
    gitExec(["config", "--global", "--get", "user.email"], "/"),
  ]);

  let hasToken = false;
  try {
    const stat = await fs.promises.stat(GIT_CREDENTIALS_PATH);
    hasToken = stat.size > 0;
  } catch {
    // file doesn't exist
  }

  res.json({ name: updatedName || "", email: updatedEmail || "", hasToken });
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

    if (data.type === "abort" && data.agentId) {
      abortAgent(data.agentId);
      return;
    }

    if (data.type === "question_answer" && data.agentId && data.answers) {
      answerQuestion(data.agentId, data.answers);
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
