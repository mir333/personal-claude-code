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
  abortAgent,
  getHistory,
  clearContext,
  sendMessage,
  setInteractiveQuestions,
  answerQuestion,
  subscribeAgent,
  unsubscribeAgent,
  getBufferedEvents,
} from "./agents.js";
import { getUsageStats } from "./usage.js";
import {
  spawnTerminal,
  getTerminal,
  killTerminal,
  resizeTerminal,
  killAllTerminals,
} from "./terminals.js";
import {
  profilesExist,
  listProfiles,
  getProfile,
  createProfile,
  verifyProfile,
  getProfilePaths,
} from "./profiles.js";
import {
  getGitDir,
  readProviders,
  writeProviders,
  getProviderToken,
  getProviderConfig,
  syncGitCredentials,
  githubApi,
  gitlabApi,
  azureDevOpsApi,
  execPromise,
  gitExec,
  gitEnvForProfile,
  configureLocalGit,
  parseRemoteUrl,
  fetchPrInfo,
  buildCloneUrl,
} from "./providers.js";

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

// --- Profile context helper ---
function getProfileContext(req) {
  if (req.profile) {
    const paths = getProfilePaths(req.profile.id);
    return {
      profileId: req.profile.id,
      gitDir: paths.gitDir,
      workspaceRoot: paths.workspaceRoot,
    };
  }
  // Legacy mode: global paths
  return {
    profileId: null,
    gitDir: "/home/node/.claude/git",
    workspaceRoot: "/workspace",
  };
}

// --- Profile endpoints (public, no auth required for login flow) ---

app.get("/api/profiles", (_req, res) => {
  res.json(listProfiles());
});

app.post("/api/profiles", (req, res) => {
  const { name, password, authPassword } = req.body;
  // AUTH_PASSWORD is required as a gate for creating profiles
  if (AUTH_PASSWORD && authPassword !== AUTH_PASSWORD) {
    return res.status(403).json({ error: "Invalid admin password" });
  }
  try {
    const profile = createProfile(name, password);
    // Auto-login
    req.session.authenticated = true;
    req.session.profileId = profile.id;
    req.session.profileName = profile.name;
    req.session.profileSlug = profile.slug;
    res.status(201).json({ profile });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Auth routes (always mounted so client can check)
app.post("/api/auth/login", (req, res) => {
  // Profile-based login
  if (req.body.profileId) {
    const { profileId, password } = req.body;
    if (!verifyProfile(profileId, password)) {
      return res.status(401).json({ error: "Wrong password" });
    }
    const profile = getProfile(profileId);
    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }
    req.session.authenticated = true;
    req.session.profileId = profile.id;
    req.session.profileName = profile.name;
    req.session.profileSlug = profile.slug;
    return res.json({ authenticated: true, profile: { id: profile.id, name: profile.name, slug: profile.slug } });
  }

  // No legacy single-password mode — AUTH_PASSWORD is only used for profile creation
  res.status(400).json({ error: "Profile login required. Please create a profile first." });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/api/auth/check", (req, res) => {
  const hasProfiles = profilesExist();

  // Already authenticated with a profile
  if (req.session.authenticated && req.session.profileId) {
    return res.json({
      authenticated: true,
      profile: {
        id: req.session.profileId,
        name: req.session.profileName,
        slug: req.session.profileSlug,
      },
    });
  }

  // Not authenticated — must create or select a profile
  res.json({
    authenticated: false,
    profile: null,
    hasProfiles,
    requiresAuthPassword: !!AUTH_PASSWORD,
  });
});

// Auth guard middleware — all users must authenticate with a profile
function requireAuth(req, res, next) {
  if (req.session.authenticated && req.session.profileId) {
    req.profile = {
      id: req.session.profileId,
      name: req.session.profileName,
      slug: req.session.profileSlug,
    };
    return next();
  }
  return res.status(401).json({ error: "Unauthorized" });
}

// Apply auth guard to all API routes (except auth/profile endpoints above)
app.use("/api", requireAuth);

// Serve static frontend — auth guard for HTML pages
app.use((req, res, next) => {
  const hasProfiles = profilesExist();
  if (req.session.authenticated) return next();
  // Allow static assets (JS, CSS, images) so the login page can load
  if (/\.(js|css|png|jpg|jpeg|svg|ico|woff2?|ttf|eot|map)(\?|$)/.test(req.path)) {
    return next();
  }
  // For HTML page requests, serve index.html (the SPA will show login)
  next();
});

app.use(express.static(path.join(__dirname, "..", "dist")));

// --- Provider config helpers (imported from providers.js) ---
const LEGACY_GIT_DIR = "/home/node/.claude/git";
fs.mkdirSync(LEGACY_GIT_DIR, { recursive: true });
process.env.GIT_CONFIG_GLOBAL = path.join(LEGACY_GIT_DIR, "gitconfig");

// Migrate legacy git-credentials to providers.json on first run
try {
  const legacyProviders = path.join(LEGACY_GIT_DIR, "providers.json");
  const legacyCreds = path.join(LEGACY_GIT_DIR, "git-credentials");
  if (!fs.existsSync(legacyProviders) && fs.existsSync(legacyCreds)) {
    const content = fs.readFileSync(legacyCreds, "utf-8");
    const match = content.match(/https:\/\/([^@]+)@github\.com/);
    if (match) {
      writeProviders({ github: { token: match[1] } }, null);
    }
  }
} catch {
  // ignore migration errors
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

// REST API
app.post("/api/agents", async (req, res) => {
  const { name, workingDirectory, localOnly, provider } = req.body;
  const ctx = getProfileContext(req);
  const profileId = ctx.profileId;
  const workspaceRoot = ctx.workspaceRoot;

  if (!name) {
    return res.status(400).json({ error: "name is required" });
  }

  // Mode 1: Existing directory (clicked from workspace list)
  if (workingDirectory) {
    const normalized = path.normalize(workingDirectory).replace(/\/+$/, "");
    if (normalized === workspaceRoot || !normalized.startsWith(workspaceRoot + "/")) {
      return res.status(400).json({ error: `workingDirectory must be a subfolder of ${workspaceRoot}` });
    }
    fs.mkdirSync(normalized, { recursive: true });
    const agent = createAgent(name, normalized, profileId);
    return res.status(201).json(agent);
  }

  // Mode 2: New project
  const slug = slugify(name);
  if (!slug) {
    return res.status(400).json({ error: "Name must contain at least one alphanumeric character" });
  }
  const projectDir = path.join(workspaceRoot, slug);

  if (fs.existsSync(projectDir)) {
    return res.status(409).json({ error: `Directory ${projectDir} already exists` });
  }

  try {
    // Ensure workspace root exists
    fs.mkdirSync(workspaceRoot, { recursive: true });

    if (localOnly) {
      // Local-only: create dir + git init
      fs.mkdirSync(projectDir, { recursive: true });
      await execPromise("git", ["init"], { cwd: projectDir, env: { ...process.env, ...gitEnvForProfile(profileId) } });
      await configureLocalGit(projectDir, profileId);
    } else if (provider === "gitlab") {
      const config = getProviderConfig("gitlab", profileId);
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
      await execPromise("git", ["clone", cloneUrl, slug], { cwd: workspaceRoot, timeout: 30000, env: { ...process.env, ...gitEnvForProfile(profileId) } });
      await configureLocalGit(projectDir, profileId);
    } else {
      // GitHub mode (default)
      const token = getProviderToken("github", profileId);
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
      await execPromise("git", ["clone", cloneUrl, slug], { cwd: workspaceRoot, timeout: 30000, env: { ...process.env, ...gitEnvForProfile(profileId) } });
      await configureLocalGit(projectDir, profileId);
    }

    const agent = createAgent(name, projectDir, profileId);
    res.status(201).json(agent);
  } catch (err) {
    try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch {}
    res.status(500).json({ error: err.message || "Failed to create project" });
  }
});

// List repos for a given provider
app.get("/api/repos/:provider", async (req, res) => {
  const { provider } = req.params;
  const profileId = req.profile?.id || null;
  try {
    if (provider === "github") {
      const token = getProviderToken("github", profileId);
      if (!token) return res.status(400).json({ error: "GitHub token not configured. Set it in Git Settings." });
      const result = await githubApi("GET", "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member", token);
      if (result.status !== 200) return res.status(400).json({ error: "GitHub token is invalid or expired. Update it in Git Settings." });
      return res.json(result.data.map((r) => ({
        full_name: r.full_name, name: r.name, private: r.private,
        description: r.description || "", updated_at: r.updated_at, owner: r.owner.login,
      })));
    }

    if (provider === "gitlab") {
      const config = getProviderConfig("gitlab", profileId);
      if (!config.token) return res.status(400).json({ error: "GitLab token not configured. Set it in Git Settings." });
      const result = await gitlabApi("GET", "/api/v4/projects?membership=true&order_by=updated_at&sort=desc&per_page=100", config.token, config.url);
      if (result.status !== 200) return res.status(400).json({ error: "GitLab token is invalid or expired. Update it in Git Settings." });
      return res.json(result.data.map((r) => ({
        full_name: r.path_with_namespace, name: r.path, private: r.visibility === "private",
        description: r.description || "", updated_at: r.last_activity_at, owner: r.namespace?.path || "",
      })));
    }

    if (provider === "azuredevops") {
      const config = getProviderConfig("azuredevops", profileId);
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
  const profileId = req.profile?.id || null;
  const token = getProviderToken("github", profileId);
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
  const ctx = getProfileContext(req);
  const profileId = ctx.profileId;
  const workspaceRoot = ctx.workspaceRoot;

  if (!repoFullName) {
    return res.status(400).json({ error: "repoFullName is required (e.g. owner/repo)" });
  }

  const repoName = repoFullName.split("/").pop();
  const projectDir = path.join(workspaceRoot, repoName);

  if (fs.existsSync(projectDir)) {
    return res.status(409).json({ error: `Directory ${projectDir} already exists` });
  }

  try {
    let cloneUrl;

    if (provider === "github") {
      const token = getProviderToken("github", profileId);
      if (!token) return res.status(400).json({ error: "GitHub token not configured. Set it in Git Settings." });
      cloneUrl = `https://${token}@github.com/${repoFullName}.git`;
    } else if (provider === "gitlab") {
      const config = getProviderConfig("gitlab", profileId);
      if (!config.token) return res.status(400).json({ error: "GitLab token not configured. Set it in Git Settings." });
      const host = (config.url || "https://gitlab.com").replace(/^https?:\/\//, "");
      cloneUrl = `https://oauth2:${config.token}@${host}/${repoFullName}.git`;
    } else if (provider === "azuredevops") {
      const config = getProviderConfig("azuredevops", profileId);
      if (!config.token) return res.status(400).json({ error: "Azure DevOps token not configured. Set it in Git Settings." });
      if (!config.organization) return res.status(400).json({ error: "Azure DevOps organization not configured. Set it in Git Settings." });
      // repoFullName is "project/repo"
      const [project, repo] = repoFullName.split("/");
      cloneUrl = `https://azuredevops:${config.token}@dev.azure.com/${config.organization}/${project}/_git/${repo}`;
    } else {
      return res.status(400).json({ error: `Unknown provider: ${provider}` });
    }

    // Ensure workspace root exists
    fs.mkdirSync(workspaceRoot, { recursive: true });
    await execPromise("git", ["clone", cloneUrl, repoName], { cwd: workspaceRoot, timeout: 60000, env: { ...process.env, ...gitEnvForProfile(profileId) } });
    await configureLocalGit(projectDir, profileId);
    const agent = createAgent(repoName, projectDir, profileId);
    res.status(201).json(agent);
  } catch (err) {
    try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch {}
    res.status(500).json({ error: err.message || "Failed to clone repository" });
  }
});

app.get("/api/agents", (req, res) => {
  const profileId = req.profile?.id || null;
  res.json(listAgents(profileId));
});

app.get("/api/agents/:id", (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  const { id, name, workingDirectory, status, interactiveQuestions } = agent;
  const pendingQuestion = agent.pendingQuestion
    ? { input: agent._pendingQuestionInput, toolUseId: agent._pendingQuestionToolUseId }
    : null;
  res.json({ id, name, workingDirectory, status, interactiveQuestions, pendingQuestion });
});

app.delete("/api/agents/:id", (req, res) => {
  const deleted = deleteAgent(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Agent not found" });
  res.status(204).end();
});

app.delete("/api/workspace/:name", (req, res) => {
  const dirName = req.params.name;
  const ctx = getProfileContext(req);
  if (!dirName || dirName.includes("/") || dirName.includes("..") || dirName.startsWith(".")) {
    return res.status(400).json({ error: "Invalid directory name" });
  }
  const dirPath = path.join(ctx.workspaceRoot, dirName);
  if (!fs.existsSync(dirPath)) {
    return res.status(404).json({ error: "Directory not found" });
  }
  // Also delete any agent associated with this directory
  const profileId = ctx.profileId;
  const agentList = listAgents(profileId);
  for (const agent of agentList) {
    if (agent.workingDirectory === dirPath) {
      deleteAgent(agent.id);
    }
  }
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to delete directory" });
  }
});

app.get("/api/workspace", async (req, res) => {
  const ctx = getProfileContext(req);
  const workspaceRoot = ctx.workspaceRoot;
  try {
    fs.mkdirSync(workspaceRoot, { recursive: true });
    const entries = await fs.promises.readdir(workspaceRoot, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => ({ name: e.name, path: path.join(workspaceRoot, e.name) }));
    res.json(dirs);
  } catch {
    res.json([]);
  }
});

app.get("/api/usage", (req, res) => {
  const profileId = req.profile?.id || null;
  res.json(getUsageStats(profileId));
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

app.post("/api/agents/:id/pr-review", async (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  const profileId = agent.profileId;

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

  const remote = parseRemoteUrl(remoteUrl, profileId);
  if (!remote) {
    return res.status(400).json({ error: "Could not detect git provider from remote URL" });
  }

  try {
    const prInfo = await fetchPrInfo(remote, branch, profileId);
    if (!prInfo) {
      return res.status(404).json({ error: `No open PR/MR found for branch "${branch}"` });
    }

    if (prInfo.provider === "github") {
      const token = getProviderToken("github", profileId);
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
      const config = getProviderConfig("gitlab", profileId);
      const result = await gitlabApi("POST", `/api/v4/projects/${prInfo.projectPath}/merge_requests/${prInfo.number}/notes`, config.token, config.url, {
        body: reviewBody.trim(),
      });
      if (result.status !== 201) {
        return res.status(502).json({ error: `GitLab API error: ${result.data.message || JSON.stringify(result.data.error) || "Unknown error"}` });
      }
      return res.json({ ok: true, url: prInfo.url, provider: "gitlab" });
    }

    if (prInfo.provider === "azuredevops") {
      const config = getProviderConfig("azuredevops", profileId);
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
  const profileId = agent.profileId;

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
      const remote = parseRemoteUrl(remoteUrl, profileId);
      if (remote) {
        try {
          pr = await fetchPrInfo(remote, branch, profileId);
        } catch {}
      }
    }
  }

  res.json({ isRepo: true, branch: branch || "unknown", state, unpushed, pr });
});

app.get("/api/agents/:id/branches", async (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });

  const cwd = agent.workingDirectory;
  const topLevel = await gitExec(["rev-parse", "--show-toplevel"], cwd);
  if (topLevel === null) {
    return res.status(400).json({ error: "Not a git repository" });
  }

  // Fetch remotes first so we see remote branches
  await execPromise("git", ["fetch", "--all", "--prune"], { cwd, timeout: 15000 }).catch(() => {});

  const [localRaw, remoteRaw, currentBranch] = await Promise.all([
    gitExec(["branch", "--format=%(refname:short)"], cwd),
    gitExec(["branch", "-r", "--format=%(refname:short)"], cwd),
    gitExec(["rev-parse", "--abbrev-ref", "HEAD"], cwd),
  ]);

  const local = localRaw ? localRaw.split("\n").filter(Boolean) : [];
  const remote = remoteRaw
    ? remoteRaw.split("\n").filter((b) => b && !b.includes("HEAD")).map((b) => b.replace(/^origin\//, ""))
    : [];

  // Merge: all unique branch names, local ones first
  const seen = new Set(local);
  const remoteOnly = remote.filter((b) => !seen.has(b));

  res.json({
    current: currentBranch || "HEAD",
    branches: [
      ...local.map((b) => ({ name: b, local: true })),
      ...remoteOnly.map((b) => ({ name: b, local: false })),
    ],
  });
});

app.post("/api/agents/:id/checkout", async (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });

  const { branch } = req.body;
  if (!branch) {
    return res.status(400).json({ error: "branch is required" });
  }

  const cwd = agent.workingDirectory;
  try {
    // Try checkout; if it's a remote-only branch, git will auto-track it
    await execPromise("git", ["checkout", branch], { cwd, timeout: 10000 });
    const current = await gitExec(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
    res.json({ ok: true, branch: current || branch });
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to checkout branch" });
  }
});

app.patch("/api/agents/:id/settings", (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  if (req.body.interactiveQuestions !== undefined) {
    setInteractiveQuestions(req.params.id, req.body.interactiveQuestions);
  }
  res.json({ interactiveQuestions: agent.interactiveQuestions });
});

// Git config endpoints (profile-scoped)
app.get("/api/git-config", async (req, res) => {
  const profileId = req.profile?.id || null;
  const gitDir = getGitDir(profileId);
  const gitconfigPath = path.join(gitDir, "gitconfig");

  const [name, email] = await Promise.all([
    gitExec(["config", "--file", gitconfigPath, "--get", "user.name"], "/"),
    gitExec(["config", "--file", gitconfigPath, "--get", "user.email"], "/"),
  ]);

  const providers = readProviders(profileId);
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
  const profileId = req.profile?.id || null;
  const gitDir = getGitDir(profileId);
  const gitconfigPath = path.join(gitDir, "gitconfig");
  const { name, email, token, githubToken, gitlabToken, gitlabUrl, azuredevopsToken, azuredevopsOrg } = req.body;

  // Ensure gitconfig file exists
  fs.mkdirSync(gitDir, { recursive: true });
  if (!fs.existsSync(gitconfigPath)) {
    fs.writeFileSync(gitconfigPath, "", { mode: 0o600 });
  }

  if (name !== undefined) {
    await new Promise((resolve) =>
      execFile("git", ["config", "--file", gitconfigPath, "user.name", name], resolve)
    );
  }
  if (email !== undefined) {
    await new Promise((resolve) =>
      execFile("git", ["config", "--file", gitconfigPath, "user.email", email], resolve)
    );
  }

  // Update provider tokens
  const providers = readProviders(profileId);

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

  writeProviders(providers, profileId);
  syncGitCredentials(profileId);

  // Return updated state
  const [updatedName, updatedEmail] = await Promise.all([
    gitExec(["config", "--file", gitconfigPath, "--get", "user.name"], "/"),
    gitExec(["config", "--file", gitconfigPath, "--get", "user.email"], "/"),
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

// --- Schedule endpoints ---
import {
  createSchedule,
  listSchedules as listAllSchedules,
  getSchedule,
  updateSchedule as updateScheduleData,
  deleteSchedule as deleteScheduleData,
  toggleSchedule,
  triggerSchedule,
  isRunning,
  getRunHistory,
  getRunDetail,
  validateCron,
  getNextRuns,
  startScheduler,
  onRunComplete,
} from "./scheduler.js";

app.get("/api/schedules", (req, res) => {
  const profileId = req.profile?.id || null;
  const items = listAllSchedules(profileId);
  // Add running status
  res.json(items.map((s) => ({ ...s, running: isRunning(s.id) })));
});

app.post("/api/schedules", (req, res) => {
  const profileId = req.profile?.id || null;
  const { name, cronExpression, provider, repoFullName, prompt } = req.body;

  if (!name || !name.trim()) return res.status(400).json({ error: "name is required" });
  if (!cronExpression) return res.status(400).json({ error: "cronExpression is required" });
  if (!provider) return res.status(400).json({ error: "provider is required" });
  if (!repoFullName) return res.status(400).json({ error: "repoFullName is required" });
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: "prompt is required" });

  const cronValid = validateCron(cronExpression);
  if (!cronValid.valid) return res.status(400).json({ error: `Invalid cron expression: ${cronValid.error}` });

  const schedule = createSchedule(profileId, { name: name.trim(), cronExpression, provider, repoFullName, prompt: prompt.trim() });
  res.status(201).json(schedule);
});

app.get("/api/schedules/:id", (req, res) => {
  const schedule = getSchedule(req.params.id);
  if (!schedule) return res.status(404).json({ error: "Schedule not found" });
  res.json({ ...schedule, running: isRunning(schedule.id) });
});

app.put("/api/schedules/:id", (req, res) => {
  const schedule = getSchedule(req.params.id);
  if (!schedule) return res.status(404).json({ error: "Schedule not found" });

  const { cronExpression } = req.body;
  if (cronExpression) {
    const cronValid = validateCron(cronExpression);
    if (!cronValid.valid) return res.status(400).json({ error: `Invalid cron expression: ${cronValid.error}` });
  }

  const updated = updateScheduleData(req.params.id, req.body);
  res.json({ ...updated, running: isRunning(updated.id) });
});

app.delete("/api/schedules/:id", (req, res) => {
  const deleted = deleteScheduleData(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Schedule not found" });
  res.status(204).end();
});

app.patch("/api/schedules/:id/toggle", (req, res) => {
  const { enabled } = req.body;
  const schedule = toggleSchedule(req.params.id, enabled);
  if (!schedule) return res.status(404).json({ error: "Schedule not found" });
  res.json({ ...schedule, running: isRunning(schedule.id) });
});

app.post("/api/schedules/:id/trigger", (req, res) => {
  const schedule = getSchedule(req.params.id);
  if (!schedule) return res.status(404).json({ error: "Schedule not found" });
  const triggered = triggerSchedule(req.params.id);
  if (!triggered) return res.status(409).json({ error: "Schedule is already running" });
  res.json({ ok: true, message: "Schedule triggered" });
});

app.get("/api/schedules/:id/runs", (req, res) => {
  const schedule = getSchedule(req.params.id);
  if (!schedule) return res.status(404).json({ error: "Schedule not found" });
  const limit = parseInt(req.query.limit) || 20;
  res.json(getRunHistory(req.params.id, limit));
});

app.get("/api/schedules/:id/runs/:runId", (req, res) => {
  const detail = getRunDetail(req.params.id, req.params.runId);
  if (!detail) return res.status(404).json({ error: "Run not found" });
  res.json(detail);
});

app.post("/api/schedules/validate-cron", (req, res) => {
  const { cronExpression } = req.body;
  if (!cronExpression) return res.status(400).json({ error: "cronExpression is required" });
  const result = validateCron(cronExpression);
  if (result.valid) {
    res.json({ valid: true, nextRuns: getNextRuns(cronExpression, 5) });
  } else {
    res.json({ valid: false, error: result.error });
  }
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
    // All users must be authenticated with a profile
    if (!request.session?.authenticated) {
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
  const connectionListeners = new Map(); // agentId -> listener fn

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

    if (data.type === "subscribe" && data.agentId) {
      const agent = getAgent(data.agentId);
      if (!agent) return;

      // Send current agent status
      ws.send(JSON.stringify({ type: "agent_status", agentId: data.agentId, status: agent.status }));

      // If agent is busy, subscribe for live updates and backfill missed events
      if (agent.status === "busy") {
        // Evict any existing listener for this agent to prevent leaks
        const existing = connectionListeners.get(data.agentId);
        if (existing) {
          unsubscribeAgent(data.agentId, existing);
        }

        // Subscribe first to avoid missing events between backfill and live
        const listener = (event) => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ ...event, agentId: data.agentId }));
          }
        };
        subscribeAgent(data.agentId, listener);
        connectionListeners.set(data.agentId, listener);

        // Then backfill missed events (client deduplicates by eventIndex)
        const sinceIndex = data.lastEventIndex || 0;
        const missed = getBufferedEvents(data.agentId, sinceIndex);
        for (const event of missed) {
          if (ws.readyState !== ws.OPEN) break;
          ws.send(JSON.stringify({ ...event, agentId: data.agentId, backfill: true }));
        }
      }
      return;
    }

    if (data.type === "message" && data.agentId && data.text) {
      // Evict any existing listener for this agent to prevent leaks
      const existingListener = connectionListeners.get(data.agentId);
      if (existingListener) {
        unsubscribeAgent(data.agentId, existingListener);
      }
      const listener = (event) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ ...event, agentId: data.agentId }));
        }
      };
      subscribeAgent(data.agentId, listener);
      connectionListeners.set(data.agentId, listener);
      try {
        await sendMessage(data.agentId, data.text);
      } catch (err) {
        ws.send(
          JSON.stringify({ type: "error", agentId: data.agentId, message: err.message })
        );
      } finally {
        unsubscribeAgent(data.agentId, listener);
        connectionListeners.delete(data.agentId);
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
    for (const [agentId, listener] of connectionListeners) {
      unsubscribeAgent(agentId, listener);
    }
    connectionListeners.clear();
    killAllTerminals(connectionTerminals);
    connectionTerminals.clear();
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Claude Web UI running on http://0.0.0.0:${PORT}`);
  // Start the scheduler after server is ready
  startScheduler();
});

// Broadcast schedule run completions to connected WebSocket clients
onRunComplete(({ scheduleId, runId, schedule, runEntry }) => {
  const msg = JSON.stringify({
    type: "schedule_run_complete",
    scheduleId,
    runId,
    scheduleName: schedule.name,
    status: runEntry.status,
  });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      try { client.send(msg); } catch {}
    }
  }
});
