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

// --- Provider config helpers ---
const GIT_PERSIST_DIR = "/home/node/.claude/git";
const GIT_CONFIG_PATH = path.join(GIT_PERSIST_DIR, "gitconfig");
const GIT_CREDENTIALS_PATH = path.join(GIT_PERSIST_DIR, "git-credentials");
const PROVIDERS_PATH = path.join(GIT_PERSIST_DIR, "providers.json");
fs.mkdirSync(GIT_PERSIST_DIR, { recursive: true });
process.env.GIT_CONFIG_GLOBAL = GIT_CONFIG_PATH;

function readProviders() {
  try {
    return JSON.parse(fs.readFileSync(PROVIDERS_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function writeProviders(providers) {
  fs.writeFileSync(PROVIDERS_PATH, JSON.stringify(providers, null, 2), { mode: 0o600 });
}

function getProviderToken(provider) {
  const providers = readProviders();
  return providers[provider]?.token || null;
}

function getProviderConfig(provider) {
  const providers = readProviders();
  return providers[provider] || {};
}

// Rebuild git-credentials from all configured provider tokens
function syncGitCredentials() {
  const providers = readProviders();
  const lines = [];
  if (providers.github?.token) {
    lines.push(`https://${providers.github.token}@github.com`);
  }
  if (providers.gitlab?.token) {
    const host = (providers.gitlab.url || "https://gitlab.com").replace(/^https?:\/\//, "");
    lines.push(`https://oauth2:${providers.gitlab.token}@${host}`);
  }
  if (providers.azuredevops?.token) {
    lines.push(`https://azuredevops:${providers.azuredevops.token}@dev.azure.com`);
  }
  fs.writeFileSync(GIT_CREDENTIALS_PATH, lines.join("\n") + (lines.length ? "\n" : ""), { mode: 0o600 });
}

// Migrate legacy git-credentials to providers.json on first run
try {
  if (!fs.existsSync(PROVIDERS_PATH) && fs.existsSync(GIT_CREDENTIALS_PATH)) {
    const content = fs.readFileSync(GIT_CREDENTIALS_PATH, "utf-8");
    const match = content.match(/https:\/\/([^@]+)@github\.com/);
    if (match) {
      writeProviders({ github: { token: match[1] } });
    }
  }
} catch {
  // ignore migration errors
}

// Generic HTTPS JSON API helper
function apiRequest(method, hostname, apiPath, headers, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname,
        path: apiPath,
        method,
        headers: {
          "User-Agent": "claude-container",
          Accept: "application/json",
          ...headers,
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

// Provider-specific API wrappers
function githubApi(method, apiPath, token, body) {
  return apiRequest(method, "api.github.com", apiPath, {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github.v3+json",
  }, body);
}

function gitlabApi(method, apiPath, token, gitlabUrl, body) {
  const host = (gitlabUrl || "https://gitlab.com").replace(/^https?:\/\//, "");
  return apiRequest(method, host, apiPath, {
    "PRIVATE-TOKEN": token,
  }, body);
}

function azureDevOpsApi(method, org, apiPath, token, body) {
  const auth = Buffer.from(`:${token}`).toString("base64");
  return apiRequest(method, "dev.azure.com", `/${org}${apiPath}`, {
    Authorization: `Basic ${auth}`,
  }, body);
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
  const { name, workingDirectory, localOnly, provider } = req.body;
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
    } else if (provider === "gitlab") {
      const config = getProviderConfig("gitlab");
      if (!config.token) {
        return res.status(400).json({ error: "GitLab token not configured. Set it in Git Settings." });
      }
      const gitlabUrl = config.url || "https://gitlab.com";

      // Get GitLab user namespace
      const userRes = await gitlabApi("GET", "/api/v4/user", config.token, gitlabUrl);
      if (userRes.status !== 200) {
        return res.status(400).json({ error: "GitLab token is invalid or expired. Update it in Git Settings." });
      }
      const username = userRes.data.username;

      // Create private project
      const repoRes = await gitlabApi("POST", "/api/v4/projects", config.token, gitlabUrl, {
        name: slug,
        visibility: "private",
      });
      if (repoRes.status === 400 && repoRes.data.message?.name) {
        return res.status(409).json({ error: repoRes.data.message.name.join(", ") });
      }
      if (repoRes.status !== 201) {
        return res.status(502).json({ error: `GitLab API error: ${repoRes.data.message || JSON.stringify(repoRes.data.error) || "Unknown error"}` });
      }

      const host = gitlabUrl.replace(/^https?:\/\//, "");
      const cloneUrl = `https://oauth2:${config.token}@${host}/${username}/${slug}.git`;
      await execPromise("git", ["clone", cloneUrl, slug], { cwd: "/workspace", timeout: 30000 });
      await configureLocalGit(projectDir);
    } else {
      // GitHub mode (default)
      const token = getProviderToken("github");
      if (!token) {
        return res.status(400).json({ error: "GitHub token not configured. Set it in Git Settings." });
      }

      const userRes = await githubApi("GET", "/user", token);
      if (userRes.status !== 200) {
        return res.status(400).json({ error: "GitHub token is invalid or expired. Update it in Git Settings." });
      }
      const owner = userRes.data.login;

      const repoRes = await githubApi("POST", "/user/repos", token, { name: slug, private: true });
      if (repoRes.status === 422) {
        const msg = repoRes.data.errors?.[0]?.message || "Repository name already taken on GitHub";
        return res.status(409).json({ error: msg });
      }
      if (repoRes.status !== 201) {
        return res.status(502).json({ error: `GitHub API error: ${repoRes.data.message || "Unknown error"}` });
      }

      const cloneUrl = `https://${token}@github.com/${owner}/${slug}.git`;
      await execPromise("git", ["clone", cloneUrl, slug], { cwd: "/workspace", timeout: 30000 });
      await configureLocalGit(projectDir);
    }

    const agent = createAgent(name, projectDir);
    res.status(201).json(agent);
  } catch (err) {
    try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch {}
    res.status(500).json({ error: err.message || "Failed to create project" });
  }
});

// List repos for a given provider
app.get("/api/repos/:provider", async (req, res) => {
  const { provider } = req.params;
  try {
    if (provider === "github") {
      const token = getProviderToken("github");
      if (!token) return res.status(400).json({ error: "GitHub token not configured. Set it in Git Settings." });
      const result = await githubApi("GET", "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member", token);
      if (result.status !== 200) return res.status(400).json({ error: "GitHub token is invalid or expired. Update it in Git Settings." });
      return res.json(result.data.map((r) => ({
        full_name: r.full_name, name: r.name, private: r.private,
        description: r.description || "", updated_at: r.updated_at, owner: r.owner.login,
      })));
    }

    if (provider === "gitlab") {
      const config = getProviderConfig("gitlab");
      if (!config.token) return res.status(400).json({ error: "GitLab token not configured. Set it in Git Settings." });
      const result = await gitlabApi("GET", "/api/v4/projects?membership=true&order_by=updated_at&sort=desc&per_page=100", config.token, config.url);
      if (result.status !== 200) return res.status(400).json({ error: "GitLab token is invalid or expired. Update it in Git Settings." });
      return res.json(result.data.map((r) => ({
        full_name: r.path_with_namespace, name: r.path, private: r.visibility === "private",
        description: r.description || "", updated_at: r.last_activity_at, owner: r.namespace?.path || "",
      })));
    }

    if (provider === "azuredevops") {
      const config = getProviderConfig("azuredevops");
      if (!config.token) return res.status(400).json({ error: "Azure DevOps token not configured. Set it in Git Settings." });
      if (!config.organization) return res.status(400).json({ error: "Azure DevOps organization not configured. Set it in Git Settings." });
      const result = await azureDevOpsApi("GET", config.organization, "/_apis/git/repositories?api-version=7.0", config.token);
      if (result.status !== 200) return res.status(400).json({ error: "Azure DevOps token is invalid or expired. Update it in Git Settings." });
      return res.json((result.data.value || []).map((r) => ({
        full_name: `${r.project.name}/${r.name}`, name: r.name, private: true,
        description: "", updated_at: "", owner: r.project.name,
        project: r.project.name,
      })));
    }

    res.status(400).json({ error: `Unknown provider: ${provider}` });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to fetch repos" });
  }
});

// Keep old endpoint for backward compat
app.get("/api/github/repos", async (req, res) => {
  const token = getProviderToken("github");
  if (!token) return res.status(400).json({ error: "GitHub token not configured. Set it in Git Settings." });
  try {
    const result = await githubApi("GET", "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member", token);
    if (result.status !== 200) return res.status(400).json({ error: "GitHub token is invalid or expired. Update it in Git Settings." });
    res.json(result.data.map((r) => ({
      full_name: r.full_name, name: r.name, private: r.private,
      description: r.description || "", updated_at: r.updated_at, owner: r.owner.login,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to fetch repos" });
  }
});

app.post("/api/agents/clone", async (req, res) => {
  const { repoFullName, provider = "github" } = req.body;
  if (!repoFullName) {
    return res.status(400).json({ error: "repoFullName is required (e.g. owner/repo)" });
  }

  const repoName = repoFullName.split("/").pop();
  const projectDir = `/workspace/${repoName}`;

  if (fs.existsSync(projectDir)) {
    return res.status(409).json({ error: `Directory /workspace/${repoName} already exists` });
  }

  try {
    let cloneUrl;

    if (provider === "github") {
      const token = getProviderToken("github");
      if (!token) return res.status(400).json({ error: "GitHub token not configured. Set it in Git Settings." });
      cloneUrl = `https://${token}@github.com/${repoFullName}.git`;
    } else if (provider === "gitlab") {
      const config = getProviderConfig("gitlab");
      if (!config.token) return res.status(400).json({ error: "GitLab token not configured. Set it in Git Settings." });
      const host = (config.url || "https://gitlab.com").replace(/^https?:\/\//, "");
      cloneUrl = `https://oauth2:${config.token}@${host}/${repoFullName}.git`;
    } else if (provider === "azuredevops") {
      const config = getProviderConfig("azuredevops");
      if (!config.token) return res.status(400).json({ error: "Azure DevOps token not configured. Set it in Git Settings." });
      if (!config.organization) return res.status(400).json({ error: "Azure DevOps organization not configured. Set it in Git Settings." });
      // repoFullName is "project/repo"
      const [project, repo] = repoFullName.split("/");
      cloneUrl = `https://azuredevops:${config.token}@dev.azure.com/${config.organization}/${project}/_git/${repo}`;
    } else {
      return res.status(400).json({ error: `Unknown provider: ${provider}` });
    }

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

// Parse git remote URL to detect provider + owner/repo
function parseRemoteUrl(remoteUrl) {
  let m;
  // GitHub (https or ssh, with or without token)
  m = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (m) return { provider: "github", owner: m[1], repo: m[2] };
  // Azure DevOps
  m = remoteUrl.match(/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/.]+)/);
  if (m) return { provider: "azuredevops", org: m[1], project: m[2], repo: m[3] };
  // GitLab (check configured URL first, then gitlab.com)
  const glConfig = getProviderConfig("gitlab");
  const glHost = (glConfig.url || "https://gitlab.com").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const glRe = new RegExp(glHost.replace(/\./g, "\\.") + "[:/]([^/]+)/([^/.]+)");
  m = remoteUrl.match(glRe);
  if (m) return { provider: "gitlab", owner: m[1], repo: m[2], host: glHost };
  // Fallback gitlab.com
  m = remoteUrl.match(/gitlab\.com[:/]([^/]+)\/([^/.]+)/);
  if (m) return { provider: "gitlab", owner: m[1], repo: m[2], host: "gitlab.com" };
  return null;
}

async function fetchPrInfo(remote, branch) {
  if (remote.provider === "github") {
    const token = getProviderToken("github");
    if (!token) return null;
    const result = await githubApi("GET", `/repos/${remote.owner}/${remote.repo}/pulls?state=open&head=${remote.owner}:${branch}`, token);
    if (result.status === 200 && result.data.length > 0) {
      const pr = result.data[0];
      return { provider: "github", number: pr.number, title: pr.title, url: pr.html_url, owner: remote.owner, repo: remote.repo };
    }
  } else if (remote.provider === "gitlab") {
    const config = getProviderConfig("gitlab");
    if (!config.token) return null;
    const projectPath = encodeURIComponent(`${remote.owner}/${remote.repo}`);
    const result = await gitlabApi("GET", `/api/v4/projects/${projectPath}/merge_requests?state=opened&source_branch=${encodeURIComponent(branch)}`, config.token, config.url);
    if (result.status === 200 && result.data.length > 0) {
      const mr = result.data[0];
      return { provider: "gitlab", number: mr.iid, title: mr.title, url: mr.web_url, projectPath };
    }
  } else if (remote.provider === "azuredevops") {
    const config = getProviderConfig("azuredevops");
    if (!config.token || !config.organization) return null;
    const result = await azureDevOpsApi("GET", config.organization,
      `/${remote.project}/_apis/git/repositories/${remote.repo}/pullrequests?searchCriteria.sourceRefName=refs/heads/${encodeURIComponent(branch)}&searchCriteria.status=active&api-version=7.0`,
      config.token);
    if (result.status === 200 && result.data.value?.length > 0) {
      const pr = result.data.value[0];
      return {
        provider: "azuredevops", number: pr.pullRequestId, title: pr.title,
        url: `https://dev.azure.com/${config.organization}/${remote.project}/_git/${remote.repo}/pullrequest/${pr.pullRequestId}`,
        org: config.organization, project: remote.project, repo: remote.repo,
      };
    }
  }
  return null;
}

app.post("/api/agents/:id/pr-review", async (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });

  const { body: reviewBody } = req.body;
  if (!reviewBody || !reviewBody.trim()) {
    return res.status(400).json({ error: "Review body is required" });
  }

  const cwd = agent.workingDirectory;
  const branch = await gitExec(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  const remoteUrl = await gitExec(["remote", "get-url", "origin"], cwd);
  if (!branch || !remoteUrl) {
    return res.status(400).json({ error: "Could not detect branch or remote" });
  }

  const remote = parseRemoteUrl(remoteUrl);
  if (!remote) {
    return res.status(400).json({ error: "Could not detect git provider from remote URL" });
  }

  try {
    const prInfo = await fetchPrInfo(remote, branch);
    if (!prInfo) {
      return res.status(404).json({ error: `No open PR/MR found for branch "${branch}"` });
    }

    if (prInfo.provider === "github") {
      const token = getProviderToken("github");
      const result = await githubApi("POST", `/repos/${prInfo.owner}/${prInfo.repo}/pulls/${prInfo.number}/reviews`, token, {
        body: reviewBody.trim(),
        event: "COMMENT",
      });
      if (result.status !== 200) {
        return res.status(502).json({ error: `GitHub API error: ${result.data.message || "Unknown error"}` });
      }
      return res.json({ ok: true, url: result.data.html_url || prInfo.url, provider: "github" });
    }

    if (prInfo.provider === "gitlab") {
      const config = getProviderConfig("gitlab");
      const result = await gitlabApi("POST", `/api/v4/projects/${prInfo.projectPath}/merge_requests/${prInfo.number}/notes`, config.token, config.url, {
        body: reviewBody.trim(),
      });
      if (result.status !== 201) {
        return res.status(502).json({ error: `GitLab API error: ${result.data.message || JSON.stringify(result.data.error) || "Unknown error"}` });
      }
      return res.json({ ok: true, url: prInfo.url, provider: "gitlab" });
    }

    if (prInfo.provider === "azuredevops") {
      const config = getProviderConfig("azuredevops");
      const result = await azureDevOpsApi("POST", config.organization,
        `/${prInfo.project}/_apis/git/repositories/${prInfo.repo}/pullrequests/${prInfo.number}/threads?api-version=7.0`,
        config.token, {
          comments: [{ parentCommentId: 0, content: reviewBody.trim(), commentType: 1 }],
          status: 1,
        });
      if (result.status !== 200 && result.status !== 201) {
        return res.status(502).json({ error: `Azure DevOps API error: ${result.data.message || "Unknown error"}` });
      }
      return res.json({ ok: true, url: prInfo.url, provider: "azuredevops" });
    }

    res.status(400).json({ error: `Unsupported provider: ${prInfo.provider}` });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to post review" });
  }
});

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

  // Also detect open PR/MR info
  let pr = null;
  if (branch && branch !== "HEAD" && branch !== "main" && branch !== "master") {
    const remoteUrl = await gitExec(["remote", "get-url", "origin"], cwd);
    if (remoteUrl) {
      const remote = parseRemoteUrl(remoteUrl);
      if (remote) {
        try {
          pr = await fetchPrInfo(remote, branch);
        } catch {}
      }
    }
  }

  res.json({ isRepo: true, branch: branch || "unknown", state, unpushed, pr });
});

app.patch("/api/agents/:id/settings", (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  if (req.body.interactiveQuestions !== undefined) {
    setInteractiveQuestions(req.params.id, req.body.interactiveQuestions);
  }
  res.json({ interactiveQuestions: agent.interactiveQuestions });
});

// Git config endpoints
app.get("/api/git-config", async (_req, res) => {
  const [name, email] = await Promise.all([
    gitExec(["config", "--global", "--get", "user.name"], "/"),
    gitExec(["config", "--global", "--get", "user.email"], "/"),
  ]);

  const providers = readProviders();
  const gh = providers.github || {};
  const gl = providers.gitlab || {};
  const az = providers.azuredevops || {};

  res.json({
    name: name || "",
    email: email || "",
    hasToken: !!(gh.token || gl.token || az.token), // backward compat
    providers: {
      github: { hasToken: !!gh.token },
      gitlab: { hasToken: !!gl.token, url: gl.url || "https://gitlab.com" },
      azuredevops: { hasToken: !!az.token, organization: az.organization || "" },
    },
  });
});

app.post("/api/git-config", async (req, res) => {
  const { name, email, token, githubToken, gitlabToken, gitlabUrl, azuredevopsToken, azuredevopsOrg } = req.body;

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

  // Update provider tokens
  const providers = readProviders();

  // Backward compat: `token` maps to GitHub
  const ghToken = githubToken || token;
  if (ghToken && ghToken.trim()) {
    providers.github = { ...providers.github, token: ghToken.trim() };
  }
  if (gitlabToken && gitlabToken.trim()) {
    providers.gitlab = { ...providers.gitlab, token: gitlabToken.trim() };
  }
  if (gitlabUrl !== undefined) {
    providers.gitlab = { ...providers.gitlab, url: gitlabUrl.trim() || "https://gitlab.com" };
  }
  if (azuredevopsToken && azuredevopsToken.trim()) {
    providers.azuredevops = { ...providers.azuredevops, token: azuredevopsToken.trim() };
  }
  if (azuredevopsOrg !== undefined) {
    providers.azuredevops = { ...providers.azuredevops, organization: azuredevopsOrg.trim() };
  }

  writeProviders(providers);
  syncGitCredentials();

  // Return updated state
  const [updatedName, updatedEmail] = await Promise.all([
    gitExec(["config", "--global", "--get", "user.name"], "/"),
    gitExec(["config", "--global", "--get", "user.email"], "/"),
  ]);

  const gh = providers.github || {};
  const gl = providers.gitlab || {};
  const az = providers.azuredevops || {};

  res.json({
    name: updatedName || "",
    email: updatedEmail || "",
    hasToken: !!(gh.token || gl.token || az.token),
    providers: {
      github: { hasToken: !!gh.token },
      gitlab: { hasToken: !!gl.token, url: gl.url || "https://gitlab.com" },
      azuredevops: { hasToken: !!az.token, organization: az.organization || "" },
    },
  });
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
