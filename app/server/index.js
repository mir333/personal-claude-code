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
  clearHistory,
  sendMessage,
  setInteractiveQuestions,
  setAgentModel,
  answerQuestion,
  subscribeAgent,
  unsubscribeAgent,
  getBufferedEvents,
  hydrateAgentContextInfo,
} from "./agents.js";
import { loadConversation } from "./storage.js";
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
  getDefaultAccount,
  getAccountById,
  getAllAccounts,
  getProviderConfigByAccountId,
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
  updateRemoteUrls,
} from "./providers.js";
import {
  listWorktrees,
  addWorktree,
  removeWorktree,
  getMainWorktreeDir,
  buildWorktreePath,
} from "./worktrees.js";
import {
  listApiTokens,
  createApiToken,
  deleteApiToken,
  resolveApiToken,
} from "./apiTokens.js";
import {
  listEnvVars,
  setEnvVar,
  deleteEnvVar,
} from "./envVars.js";
import {
  loadResendConfig,
  saveResendConfig,
  deleteResendConfig,
  hasResendToken,
} from "./resendConfig.js";
import { sendTaskCompletionEmail } from "./emailer.js";
import {
  acquireSessionAgent,
  hashMessagesPrefix,
  touchSessionAgent,
  evictByTokenId,
} from "./sessionAgents.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);
const bootId = crypto.randomUUID();

// --- Global process-level error handlers ---
// Ensure any uncaught errors or unhandled promise rejections are visible in
// the container's stdout/stderr (and thus in `docker logs`) instead of being
// silently swallowed.
process.on("uncaughtException", (err, origin) => {
  console.error(`[process] Uncaught exception (origin=${origin}):`, err);
});
process.on("unhandledRejection", (reason, promise) => {
  console.error("[process] Unhandled promise rejection:", reason);
  if (reason && reason.stack) {
    console.error(reason.stack);
  }
});
process.on("warning", (warning) => {
  console.warn(`[process] Node warning: ${warning.name}: ${warning.message}`);
  if (warning.stack) console.warn(warning.stack);
});

const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
const BASE_URL_PROTOCOL = process.env.BASE_URL_PROTOCOL || "https";

/**
 * Wrap raw markdown in a self-contained HTML page that renders it nicely.
 * Uses marked.js + highlight.js from CDN for zero-dependency rendering.
 */
function renderMarkdownHtml(markdown, title = "Summary") {
  const escaped = markdown.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title.replace(/</g, "&lt;")}</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.8.1/github-markdown-dark.min.css" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github-dark.min.css" />
  <style>
    body {
      background: #0d1117;
      display: flex;
      justify-content: center;
      padding: 32px 16px;
      margin: 0;
    }
    .markdown-body {
      max-width: 920px;
      width: 100%;
      padding: 32px;
      border: 1px solid #30363d;
      border-radius: 8px;
    }
    @media (prefers-color-scheme: light) {
      body { background: #fff; }
      .markdown-body { border-color: #d0d7de; }
    }
  </style>
</head>
<body>
  <article id="content" class="markdown-body"></article>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/marked/15.0.7/marked.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js"></script>
  <script>
    marked.setOptions({
      highlight: function(code, lang) {
        if (lang && hljs.getLanguage(lang)) {
          return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
      },
    });
    document.getElementById("content").innerHTML = marked.parse(\`${escaped}\`);
  </script>
</body>
</html>`;
}

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

// --- Claude credentials check (public, no auth required) ---
app.get("/api/claude-status", (_req, res) => {
  const configDir = process.env.CLAUDE_CONFIG_DIR || "/home/node/.claude";
  const credsPath = path.join(configDir, ".credentials.json");

  let hasCredentials = false;
  let authMethod = null;

  try {
    if (fs.existsSync(credsPath)) {
      const creds = JSON.parse(fs.readFileSync(credsPath, "utf-8"));
      // Check for OAuth tokens (Claude Pro/Max)
      if (creds.claudeAiOauth?.accessToken) {
        hasCredentials = true;
        authMethod = "oauth";
      }
    }
  } catch (err) {
    // Typically parse errors - log so they surface in docker logs
    console.error(`[api] /api/claude-status failed to parse credentials at ${credsPath}:`, err.message);
  }

  // Also check for API key in environment
  if (!hasCredentials && process.env.ANTHROPIC_API_KEY) {
    hasCredentials = true;
    authMethod = "api_key";
  }

  res.json({ hasCredentials, authMethod });
});

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
    console.error("[api] POST /api/profiles failed:", err);
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

// --- Public webhook endpoints (no session auth, token-validated) ---
app.post("/api/webhooks/tasks/:taskId/:token", express.text({ type: "*/*", limit: "100kb" }), (req, res) => {
  const { taskId, token } = req.params;
  const task = getTaskByWebhookToken(taskId, token);
  if (!task) return res.status(404).json({ error: "Not found" });
  if (isRunning(taskId)) return res.status(409).json({ error: "Task is already running" });

  const payload = req.body && typeof req.body === "string" && req.body.trim() ? req.body : null;
  const result = triggerTask(taskId, payload ? { payload } : undefined);
  if (!result) return res.status(409).json({ error: "Task is already running" });
  const baseUrl = `${BASE_URL_PROTOCOL}://${req.get("host")}`;
  const summaryUrl = `${baseUrl}/api/webhooks/tasks/${taskId}/${token}/runs/${result.runId}/summary`;
  res.json({ ok: true, message: "Task triggered via webhook", runId: result.runId, summaryUrl, summaryFilename: result.summaryFilename });
});

/**
 * Send a summary file — raw markdown or rendered HTML depending on ?render query param.
 */
function sendSummaryFile(res, filePath, taskName) {
  const render = res.req.query.render === "true" || res.req.query.render === "1";
  if (!render) {
    return res.sendFile(filePath, { dotfiles: "allow" });
  }
  try {
    const md = fs.readFileSync(filePath, "utf-8");
    res.type("html").send(renderMarkdownHtml(md, taskName || "Summary"));
  } catch (err) {
    res.status(500).json({ error: "Failed to render summary" });
  }
}

// Public summary endpoint via webhook token — serves from .claude-tasks/ in workspace
app.get("/api/webhooks/tasks/:taskId/:token/runs/:runId/summary", (req, res) => {
  const { taskId, token, runId } = req.params;
  const task = getTaskByWebhookToken(taskId, token);
  if (!task) return res.status(404).json({ error: "Not found" });

  // Check if the task is still running
  if (isRunning(taskId)) {
    return res.status(202).json({
      error: "Task is still running",
      message: "The task has not completed yet. Please retry after the task finishes.",
      running: true,
    });
  }

  // Look up the summaryFilename from the run entry
  const detail = getRunDetail(taskId, runId);
  if (!detail || !detail.summaryFilename) {
    // Fallback to archived summary.md
    const filePath = getRunArtifactPath(taskId, runId, "summary.md");
    if (!filePath) return res.status(404).json({ error: "Summary not found" });
    return sendSummaryFile(res, filePath, task.name);
  }

  // Try .claude-tasks/ first, then fall back to archive
  const wsPath = getWorkspaceSummaryPath(taskId, detail.summaryFilename);
  if (wsPath) return sendSummaryFile(res, wsPath, task.name);

  const filePath = getRunArtifactPath(taskId, runId, "summary.md");
  if (!filePath) return res.status(404).json({ error: "Summary not found" });
  sendSummaryFile(res, filePath, task.name);
});

// Public artifact access via webhook token (no session required)
app.get("/api/webhooks/tasks/:taskId/:token/runs/:runId/artifacts/:filename", (req, res) => {
  const { taskId, token, runId, filename } = req.params;
  const task = getTaskByWebhookToken(taskId, token);
  if (!task) return res.status(404).json({ error: "Not found" });

  // Check if the task is still running (artifact may not exist yet)
  if (isRunning(taskId)) {
    return res.status(202).json({
      error: "Task is still running",
      message: "The task has not completed yet. Please retry after the task finishes.",
      running: true,
    });
  }

  const filePath = getRunArtifactPath(taskId, runId, filename);
  if (!filePath) return res.status(404).json({ error: "Artifact not found" });
  res.sendFile(filePath, { dotfiles: "allow" });
});

// --- Vercel AI SDK compatible endpoint (OpenAI-compatible) ---
// Authenticated via Bearer token from Authorization header.
// Each token is bound to a specific agent, so calls run as that agent.
//
// Endpoint: POST /api/v1/chat/completions
// Body: { model?, messages: [{ role, content }], stream?: boolean }
// Stream: Server-Sent Events in OpenAI chat-completion chunk format.

function extractBearerToken(req) {
  const h = req.headers["authorization"] || req.headers["Authorization"];
  if (!h || typeof h !== "string") return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function extractLastUserMessage(messages) {
  if (!Array.isArray(messages)) return "";
  // AI SDK sends the full conversation; Claude agents already maintain their
  // own session history via sessionId, so we only forward the latest user turn.
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "user") {
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content)) {
        return m.content
          .filter((p) => p && (p.type === "text" || typeof p.text === "string"))
          .map((p) => p.text || "")
          .join("");
      }
    }
  }
  return "";
}

app.get("/api/v1/models", (req, res) => {
  const token = extractBearerToken(req);
  if (!token) return res.status(401).json({ error: { message: "Missing bearer token", type: "invalid_request_error" } });
  const resolved = resolveApiToken(token);
  if (!resolved) return res.status(401).json({ error: { message: "Invalid token", type: "invalid_request_error" } });

  // Report a single synthetic model named after the token's bound workspace.
  const workspaceName = path.basename(resolved.workingDirectory || "") || "workspace";
  const modelId = `claude-agent-${workspaceName}`;
  res.json({
    object: "list",
    data: [{ id: modelId, object: "model", created: Math.floor(Date.now() / 1000), owned_by: "personal-claude-code" }],
  });
});

app.post("/api/v1/chat/completions", async (req, res) => {
  const token = extractBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: { message: "Missing bearer token", type: "invalid_request_error" } });
  }
  const resolved = resolveApiToken(token);
  if (!resolved) {
    return res.status(401).json({ error: { message: "Invalid token", type: "invalid_request_error" } });
  }

  const { messages, stream } = req.body || {};
  const userText = extractLastUserMessage(messages);
  if (!userText || !userText.trim()) {
    return res.status(400).json({ error: { message: "messages must contain a user message with non-empty content", type: "invalid_request_error" } });
  }

  // The token is bound to a workspace directory — verify it still exists before
  // spinning up an agent (prevents confusing ENOENT crashes deep in the SDK).
  if (!resolved.workingDirectory || !fs.existsSync(resolved.workingDirectory)) {
    return res.status(410).json({
      error: {
        message: `Working directory no longer exists: ${resolved.workingDirectory}. Revoke and recreate this token.`,
        type: "invalid_request_error",
      },
    });
  }

  // Per-session ephemeral agent: hash the message prefix (everything except the
  // new user turn) so follow-up requests in the same conversation reuse the
  // same Claude SDK session, while unrelated conversations get their own agent.
  const sessionHash = hashMessagesPrefix(messages);
  const workspaceName = path.basename(resolved.workingDirectory) || "workspace";
  const agent = acquireSessionAgent({
    tokenId: resolved.id,
    sessionHash,
    workingDirectory: resolved.workingDirectory,
    profileId: resolved.profileId,
    agentName: `api-${workspaceName}-${sessionHash.slice(0, 8)}`,
  });

  if (agent.status === "busy") {
    return res.status(409).json({ error: { message: "Session is already processing a request, retry shortly", type: "server_error" } });
  }
  touchSessionAgent(resolved.id, sessionHash);

  const shouldStream = stream !== false; // default true (AI SDK always streams)
  const completionId = "chatcmpl-" + crypto.randomUUID().replace(/-/g, "");
  const created = Math.floor(Date.now() / 1000);
  const modelId = `claude-agent-${workspaceName}`;

  // Collect streamed text from the agent via a listener
  let accumulatedText = "";
  let finishEvent = null;
  let errorEvent = null;
  let finished = false;

  if (shouldStream) {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    function sseWrite(payload) {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }

    // Send initial role chunk (OpenAI format expects this first)
    sseWrite({
      id: completionId,
      object: "chat.completion.chunk",
      created,
      model: modelId,
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    });

    const listener = (event) => {
      if (event.type === "text_delta" && typeof event.text === "string") {
        accumulatedText += event.text;
        sseWrite({
          id: completionId,
          object: "chat.completion.chunk",
          created,
          model: modelId,
          choices: [{ index: 0, delta: { content: event.text }, finish_reason: null }],
        });
      } else if (event.type === "done") {
        finishEvent = event;
      } else if (event.type === "error") {
        errorEvent = event;
      }
    };

    // Subscribe BEFORE kicking off sendMessage so we cannot miss early events
    subscribeAgent(agent.id, listener);

    // Only abort when the client really disconnected mid-stream. `res.on('close')`
    // with a `writableEnded` guard avoids a race where Node emits `close` on the
    // request *after* we cleanly end the response, which previously aborted the
    // (already-finished) agent and surfaced as "Claude Code process aborted by user".
    let aborted = false;
    const onClientDisconnect = () => {
      if (finished || res.writableEnded || aborted) return;
      aborted = true;
      try {
        abortAgent(agent.id);
      } catch (err) {
        console.error(`[api] abortAgent(${agent.id}) on client disconnect failed:`, err.message);
      }
    };
    res.on("close", onClientDisconnect);

    try {
      await sendMessage(agent.id, userText.trim(), null);
    } catch (err) {
      console.error(`[api] Agent ${agent.id} streaming sendMessage failed:`, err);
      errorEvent = { message: err.message || "Agent error" };
    } finally {
      finished = true;
      unsubscribeAgent(agent.id, listener);
      res.off("close", onClientDisconnect);
    }

    // Some models return their entire reply as a single final `result` instead of
    // incremental text_deltas (happens reliably for very short prompts like "hi").
    // If nothing was streamed incrementally, emit the full result as one content
    // chunk so the client doesn't see an empty response.
    if (!errorEvent && !accumulatedText && finishEvent && typeof finishEvent.result === "string" && finishEvent.result.length > 0) {
      sseWrite({
        id: completionId,
        object: "chat.completion.chunk",
        created,
        model: modelId,
        choices: [{ index: 0, delta: { content: finishEvent.result }, finish_reason: null }],
      });
      accumulatedText = finishEvent.result;
    }

    // Final chunk with finish_reason
    if (errorEvent) {
      sseWrite({
        id: completionId,
        object: "chat.completion.chunk",
        created,
        model: modelId,
        choices: [{ index: 0, delta: {}, finish_reason: "error" }],
        error: { message: errorEvent.message || "Agent error" },
      });
    } else {
      sseWrite({
        id: completionId,
        object: "chat.completion.chunk",
        created,
        model: modelId,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      });
    }
    if (!res.writableEnded) {
      res.write("data: [DONE]\n\n");
      res.end();
    }
    return;
  }

  // Non-streaming fallback: collect everything and return a single JSON response
  const listener = (event) => {
    if (event.type === "text_delta" && typeof event.text === "string") {
      accumulatedText += event.text;
    } else if (event.type === "done") {
      finishEvent = event;
    } else if (event.type === "error") {
      errorEvent = event;
    }
  };
  subscribeAgent(agent.id, listener);
  let abortedNonStream = false;
  const onClientDisconnectNonStream = () => {
    if (finished || res.writableEnded || abortedNonStream) return;
    abortedNonStream = true;
    try { abortAgent(agent.id); } catch {}
  };
  res.on("close", onClientDisconnectNonStream);
  try {
    await sendMessage(agent.id, userText.trim(), null);
  } catch (err) {
    console.error(`[api] Agent ${agent.id} non-streaming sendMessage failed:`, err);
    errorEvent = { message: err.message || "Agent error" };
  } finally {
    finished = true;
    unsubscribeAgent(agent.id, listener);
    res.off("close", onClientDisconnectNonStream);
  }

  if (errorEvent) {
    return res.status(500).json({ error: { message: errorEvent.message || "Agent error", type: "server_error" } });
  }

  const finalText = (finishEvent && finishEvent.result) || accumulatedText;
  res.json({
    id: completionId,
    object: "chat.completion",
    created,
    model: modelId,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: finalText },
        finish_reason: "stop",
      },
    ],
    usage: (finishEvent && finishEvent.usage) ? {
      prompt_tokens: finishEvent.usage.input_tokens || 0,
      completion_tokens: finishEvent.usage.output_tokens || 0,
      total_tokens: (finishEvent.usage.input_tokens || 0) + (finishEvent.usage.output_tokens || 0),
    } : undefined,
  });
});

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
      writeProviders([{ id: crypto.randomUUID(), label: "Default", token: match[1], type: "github" }], null);
    }
  }
} catch (err) {
  // ignore migration errors but log them for visibility in docker logs
  console.error("[api] Provider token migration error:", err);
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

/** Check if a conversation has user messages after the last context_cleared event */
function hasRecoverableHistory(entries) {
  if (!entries || entries.length === 0) return false;
  // Find the index of the last context_cleared event
  let lastClearIdx = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].type === "context_cleared") {
      lastClearIdx = i;
      break;
    }
  }
  // Check if there are any user messages after the last clear
  for (let i = lastClearIdx + 1; i < entries.length; i++) {
    if (entries[i].type === "user") return true;
  }
  return false;
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

    // Check if there is recoverable conversation history from a previous session.
    // If so, the agent will use the SDK's options.continue to resume automatically.
    const existingConvo = loadConversation(normalized);
    const continueSession = hasRecoverableHistory(existingConvo);

    const agent = createAgent(name, normalized, profileId, continueSession);
    // Hydrate context info from stored history so the gauge shows immediately
    if (continueSession) {
      hydrateAgentContextInfo(agent, existingConvo);
    }
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
    console.error("[api] POST /api/agents (create project) failed:", err);
    try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch (rmErr) {
      console.error("[api] Cleanup after failed project create also failed:", rmErr);
    }
    res.status(500).json({ error: err.message || "Failed to create project" });
  }
});

// List repos for a given provider (optional ?accountId= to select specific account)
app.get("/api/repos/:provider", async (req, res) => {
  const { provider } = req.params;
  const { accountId } = req.query;
  const profileId = req.profile?.id || null;

  // Resolve the account config: specific account if accountId provided, else default
  function resolveConfig(providerName) {
    if (accountId) return getProviderConfigByAccountId(accountId, profileId);
    return getProviderConfig(providerName, profileId);
  }

  try {
    if (provider === "github") {
      const config = resolveConfig("github");
      if (!config.token) return res.status(400).json({ error: "GitHub token not configured. Set it in Git Settings." });
      const result = await githubApi("GET", "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member", config.token);
      if (result.status !== 200) return res.status(400).json({ error: "GitHub token is invalid or expired. Update it in Git Settings." });
      return res.json(result.data.map((r) => ({
        full_name: r.full_name, name: r.name, private: r.private,
        description: r.description || "", updated_at: r.updated_at, owner: r.owner.login,
      })));
    }

    if (provider === "gitlab") {
      const config = resolveConfig("gitlab");
      if (!config.token) return res.status(400).json({ error: "GitLab token not configured. Set it in Git Settings." });
      const result = await gitlabApi("GET", "/api/v4/projects?membership=true&order_by=updated_at&sort=desc&per_page=100", config.token, config.url);
      if (result.status !== 200) return res.status(400).json({ error: "GitLab token is invalid or expired. Update it in Git Settings." });
      return res.json(result.data.map((r) => ({
        full_name: r.path_with_namespace, name: r.path, private: r.visibility === "private",
        description: r.description || "", updated_at: r.last_activity_at, owner: r.namespace?.path || "",
      })));
    }

    if (provider === "azuredevops") {
      const config = resolveConfig("azuredevops");
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
    console.error(`[api] GET /api/repos/${provider} failed:`, err);
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
    console.error("[api] GET /api/github/repos failed:", err);
    res.status(500).json({ error: err.message || "Failed to fetch repos" });
  }
});

app.post("/api/agents/clone", async (req, res) => {
  const { repoFullName, provider = "github", accountId } = req.body;
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
    // Resolve config: specific account if accountId provided, else default
    const config = accountId
      ? getProviderConfigByAccountId(accountId, profileId)
      : getProviderConfig(provider, profileId);

    let cloneUrl;

    if (provider === "github") {
      if (!config.token) return res.status(400).json({ error: "GitHub token not configured. Set it in Git Settings." });
      cloneUrl = `https://${config.token}@github.com/${repoFullName}.git`;
    } else if (provider === "gitlab") {
      if (!config.token) return res.status(400).json({ error: "GitLab token not configured. Set it in Git Settings." });
      const host = (config.url || "https://gitlab.com").replace(/^https?:\/\//, "");
      cloneUrl = `https://oauth2:${config.token}@${host}/${repoFullName}.git`;
    } else if (provider === "azuredevops") {
      if (!config.token) return res.status(400).json({ error: "Azure DevOps token not configured. Set it in Git Settings." });
      if (!config.organization) return res.status(400).json({ error: "Azure DevOps organization not configured. Set it in Git Settings." });
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
    console.error(`[api] POST /api/agents/clone (${repoFullName}) failed:`, err);
    try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch (rmErr) {
      console.error("[api] Cleanup after failed clone also failed:", rmErr);
    }
    res.status(500).json({ error: err.message || "Failed to clone repository" });
  }
});

// --- API token management (for the Vercel AI SDK endpoint) ---
app.get("/api/api-tokens", (req, res) => {
  const profileId = req.profile?.id || null;
  res.json(listApiTokens(profileId));
});

app.post("/api/api-tokens", (req, res) => {
  const profileId = req.profile?.id || null;
  const { label, workingDirectory } = req.body || {};
  if (!label || !workingDirectory) {
    return res.status(400).json({ error: "label and workingDirectory are required" });
  }
  try {
    // createApiToken validates that workingDirectory is under the profile's workspaceRoot.
    const created = createApiToken(profileId, { label, workingDirectory });
    res.status(201).json(created);
  } catch (err) {
    console.error("[api] POST /api/api-tokens failed:", err);
    res.status(400).json({ error: err.message || "Failed to create token" });
  }
});

app.delete("/api/api-tokens/:id", (req, res) => {
  const profileId = req.profile?.id || null;
  const ok = deleteApiToken(profileId, req.params.id);
  if (!ok) return res.status(404).json({ error: "Token not found" });
  // Kill any in-flight or cached session-agents for this token.
  try { evictByTokenId(req.params.id); } catch (err) {
    console.error("[api] evictByTokenId failed:", err.message);
  }
  res.status(204).end();
});

// --- Environment variables (profile-scoped secrets for agent tool execution) ---

app.get("/api/env-vars", (req, res) => {
  const profileId = req.profile?.id || null;
  res.json(listEnvVars(profileId));
});

app.post("/api/env-vars", (req, res) => {
  const profileId = req.profile?.id || null;
  const { name, value } = req.body || {};
  try {
    const result = setEnvVar(profileId, { name, value });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to set variable" });
  }
});

app.delete("/api/env-vars/:id", (req, res) => {
  const profileId = req.profile?.id || null;
  const ok = deleteEnvVar(profileId, req.params.id);
  if (!ok) return res.status(404).json({ error: "Variable not found" });
  res.status(204).end();
});

// --- Resend email configuration (per-profile) ---

app.get("/api/resend-config", (req, res) => {
  const profileId = req.profile?.id || null;
  const { from } = loadResendConfig(profileId);
  res.json({ configured: hasResendToken(profileId), from: from || "" });
});

app.post("/api/resend-config", (req, res) => {
  const profileId = req.profile?.id || null;
  const body = req.body || {};
  const partial = {};

  if (Object.prototype.hasOwnProperty.call(body, "token")) {
    const t = (body.token || "").trim();
    if (t) partial.token = t;
  }
  if (Object.prototype.hasOwnProperty.call(body, "from")) {
    partial.from = (body.from || "").trim();
  }

  if (Object.keys(partial).length === 0) {
    return res.status(400).json({ error: "Provide a token and/or from address" });
  }

  // If saving for the first time, a token must be present.
  if (!hasResendToken(profileId) && !partial.token) {
    return res.status(400).json({ error: "Resend API token is required" });
  }

  saveResendConfig(profileId, partial);
  const { from } = loadResendConfig(profileId);
  res.json({ configured: hasResendToken(profileId), from: from || "" });
});

app.delete("/api/resend-config", (req, res) => {
  const profileId = req.profile?.id || null;
  deleteResendConfig(profileId);
  res.status(204).end();
});

app.get("/api/agents", (req, res) => {
  const profileId = req.profile?.id || null;
  res.json(listAgents(profileId));
});

app.get("/api/agents/:id", (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  const { id, name, workingDirectory, status, interactiveQuestions, model } = agent;
  const pendingQuestion = agent.pendingQuestion
    ? { input: agent._pendingQuestionInput, toolUseId: agent._pendingQuestionToolUseId }
    : null;
  res.json({
    id, name, workingDirectory, status, interactiveQuestions,
    model: model || null, pendingQuestion,
    lastInputTokens: agent.lastInputTokens || 0,
    contextWindow: agent.contextWindow || 0,
  });
});

app.delete("/api/agents/:id", (req, res) => {
  const deleted = deleteAgent(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Agent not found" });
  res.status(204).end();
});

app.delete("/api/workspace/:name", async (req, res) => {
  const dirName = req.params.name;
  const ctx = getProfileContext(req);
  if (!dirName || dirName.includes("/") || dirName.includes("..") || dirName.startsWith(".")) {
    return res.status(400).json({ error: "Invalid directory name" });
  }
  const dirPath = path.join(ctx.workspaceRoot, dirName);
  if (!fs.existsSync(dirPath)) {
    return res.status(404).json({ error: "Directory not found" });
  }

  const profileId = ctx.profileId;
  const agentList = listAgents(profileId);

  // If this is a main worktree, clean up all linked worktrees first
  try {
    const mainDir = await getMainWorktreeDir(dirPath);
    if (mainDir && mainDir === dirPath) {
      const wts = await listWorktrees(dirPath);
      for (const wt of wts) {
        if (!wt.isMain) {
          // Delete agents for this worktree
          for (const agent of agentList) {
            if (agent.workingDirectory === wt.path) {
              deleteAgent(agent.id);
            }
          }
          // Remove the worktree
          await removeWorktree(dirPath, wt.path);
        }
      }
    }
  } catch (err) {
    // non-critical, continue with deletion
    console.error(`[api] DELETE /api/workspace/${dirName} - worktree cleanup failed (continuing):`, err);
  }

  // Delete any agent associated with this directory
  for (const agent of agentList) {
    if (agent.workingDirectory === dirPath) {
      deleteAgent(agent.id);
    }
  }

  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (err) {
    console.error(`[api] DELETE /api/workspace/${dirName} failed:`, err);
    res.status(500).json({ error: err.message || "Failed to delete directory" });
  }
});

app.delete("/api/workspace/:name/worktree", async (req, res) => {
  const dirName = req.params.name;
  const ctx = getProfileContext(req);
  if (!dirName || dirName.includes("/") || dirName.includes("..") || dirName.startsWith(".")) {
    return res.status(400).json({ error: "Invalid directory name" });
  }

  const { worktreePath } = req.body;
  if (!worktreePath) {
    return res.status(400).json({ error: "worktreePath is required" });
  }

  const dirPath = path.join(ctx.workspaceRoot, dirName);
  if (!fs.existsSync(dirPath)) {
    return res.status(404).json({ error: "Project not found" });
  }

  const mainDir = await getMainWorktreeDir(dirPath);
  if (!mainDir) {
    return res.status(400).json({ error: "Not a git repository" });
  }

  // Don't allow removing the main worktree
  if (worktreePath === mainDir) {
    return res.status(400).json({ error: "Cannot remove the main worktree. Delete the project instead." });
  }

  // Find and abort/delete any agent associated with this worktree
  const profileId = ctx.profileId;
  const agentList = listAgents(profileId);
  for (const agent of agentList) {
    if (agent.workingDirectory === worktreePath) {
      if (agent.status === "busy") {
        abortAgent(agent.id);
      }
      deleteAgent(agent.id);
    }
  }

  // Remove the worktree
  const result = await removeWorktree(mainDir, worktreePath);
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }

  res.status(204).end();
});

app.get("/api/workspace", async (req, res) => {
  const ctx = getProfileContext(req);
  const workspaceRoot = ctx.workspaceRoot;
  try {
    fs.mkdirSync(workspaceRoot, { recursive: true });
    const entries = await fs.promises.readdir(workspaceRoot, { withFileTypes: true });
    const allDirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => ({ name: e.name, path: path.join(workspaceRoot, e.name) }));

    // Build structured response with worktree grouping
    // Classify all dirs in parallel: check if repo, find main worktree dir
    const dirInfo = await Promise.all(
      allDirs.map(async (dir) => {
        const topLevel = await gitExec(["rev-parse", "--show-toplevel"], dir.path);
        const isRepo = topLevel !== null;
        if (!isRepo) return { dir, isRepo: false, mainDir: null, wts: [] };
        const mainDir = await getMainWorktreeDir(dir.path);
        const isMainWorktree = !mainDir || mainDir === dir.path;
        const wts = isMainWorktree ? await listWorktrees(dir.path) : [];
        return { dir, isRepo: true, mainDir, isMainWorktree, wts };
      })
    );

    const worktreeSiblings = new Set();
    const projects = [];

    for (const info of dirInfo) {
      if (!info.isRepo) {
        projects.push({ name: info.dir.name, path: info.dir.path, isRepo: false, worktrees: [] });
        continue;
      }
      if (!info.isMainWorktree) {
        worktreeSiblings.add(info.dir.path);
        continue;
      }
      projects.push({
        name: info.dir.name,
        path: info.dir.path,
        isRepo: true,
        worktrees: info.wts.map((wt) => ({
          branch: wt.branch,
          path: wt.path,
          isMain: wt.isMain,
        })),
      });
    }

    // Second pass: add any orphaned worktree sibling dirs that weren't claimed
    for (const info of dirInfo) {
      if (worktreeSiblings.has(info.dir.path) && !projects.some((p) => p.worktrees.some((wt) => wt.path === info.dir.path))) {
        projects.push({ name: info.dir.name, path: info.dir.path, isRepo: true, worktrees: [] });
      }
    }

    res.json(projects);
  } catch (err) {
    console.error("[api] GET /api/workspace (list projects) failed:", err);
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

// Trigger native SDK compaction by sending the `/compact` slash command to the
// agent. Unlike clear-context (which wipes the session entirely), compaction
// asks Claude to summarize the conversation history while keeping the session
// alive — so prior context is preserved at a much lower token cost.
app.post("/api/agents/:id/compact", (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  if (agent.status === "busy") return res.status(409).json({ error: "Agent is busy" });
  // Fire-and-forget: streaming events flow to subscribers via the normal path.
  sendMessage(req.params.id, "/compact", null).catch((err) => {
    console.error(`[api] Agent ${req.params.id} compact failed:`, err);
  });
  res.json({ ok: true });
});

app.delete("/api/agents/:id/history", (req, res) => {
  const ok = clearHistory(req.params.id);
  if (!ok) return res.status(404).json({ error: "Agent not found" });
  res.json({ ok: true });
});

app.get("/api/agents/:id/history", (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  const limit = req.query.limit != null ? parseInt(req.query.limit, 10) : undefined;
  const offset = req.query.offset != null ? parseInt(req.query.offset, 10) : 0;
  const history = getHistory(req.params.id, limit, offset);
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
    console.error("[api] POST PR review failed:", err);
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
        } catch (err) {
          console.error(`[api] fetchPrInfo for branch "${branch}" failed:`, err.message);
        }
      }
    }
  }

  res.json({ isRepo: true, branch: branch || "unknown", state, unpushed, pr });
});

// --- File browsing / editing endpoints ---

const EXT_TO_LANGUAGE = {
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript", mts: "typescript",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java",
  json: "json", md: "markdown", css: "css", scss: "scss", less: "less",
  html: "html", htm: "html", xml: "xml", svg: "xml",
  yaml: "yaml", yml: "yaml", toml: "toml",
  sh: "shell", bash: "shell", zsh: "shell", fish: "shell",
  sql: "sql", graphql: "graphql",
  c: "c", cpp: "cpp", h: "cpp", hpp: "cpp",
  cs: "csharp", swift: "swift", kt: "kotlin",
  php: "php", lua: "lua", r: "r", pl: "perl",
  dockerfile: "dockerfile", makefile: "makefile",
  ini: "ini", conf: "ini", env: "ini",
  txt: "plaintext", log: "plaintext", csv: "plaintext",
};

const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "svg",
  "mp3", "mp4", "wav", "ogg", "webm", "avi", "mov",
  "zip", "tar", "gz", "bz2", "7z", "rar",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "exe", "dll", "so", "dylib", "bin",
  "woff", "woff2", "ttf", "eot", "otf",
  "pyc", "class", "o", "a",
]);

function detectLanguage(filePath) {
  const base = path.basename(filePath).toLowerCase();
  if (base === "dockerfile") return "dockerfile";
  if (base === "makefile") return "makefile";
  const ext = base.split(".").pop();
  return EXT_TO_LANGUAGE[ext] || "plaintext";
}

function resolveAgentPath(agent, relativePath) {
  const resolved = path.resolve(agent.workingDirectory, relativePath || ".");
  const base = agent.workingDirectory.replace(/\/+$/, "");
  if (resolved !== base && !resolved.startsWith(base + "/")) return null;
  return resolved;
}

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

app.get("/api/agents/:id/files", async (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });

  const resolved = resolveAgentPath(agent, req.query.path);
  if (!resolved) return res.status(400).json({ error: "Invalid path" });

  try {
    const entries = await fs.promises.readdir(resolved, { withFileTypes: true });
    const items = entries
      .filter((e) => e.name !== ".git" && !e.name.startsWith(".claude"))
      .map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "directory" : "file",
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    res.json(items);
  } catch (err) {
    if (err.code === "ENOENT") return res.status(404).json({ error: "Directory not found" });
    console.error(`[api] GET /api/agents/${req.params.id}/files failed:`, err);
    res.status(500).json({ error: err.message || "Failed to list directory" });
  }
});

app.get("/api/agents/:id/file", async (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });

  const relativePath = req.query.path;
  if (!relativePath) return res.status(400).json({ error: "path query parameter is required" });

  const resolved = resolveAgentPath(agent, relativePath);
  if (!resolved) return res.status(400).json({ error: "Invalid path" });

  try {
    const stat = await fs.promises.stat(resolved);
    if (stat.isDirectory()) return res.status(400).json({ error: "Path is a directory" });
    if (stat.size > MAX_FILE_SIZE) return res.status(413).json({ error: "File too large (max 2MB)" });

    // Check for binary by extension
    const ext = path.extname(resolved).slice(1).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      return res.json({ path: relativePath, binary: true, language: "plaintext" });
    }

    const content = await fs.promises.readFile(resolved, "utf-8");

    // Check for binary content (null bytes in first 8KB)
    const sample = content.slice(0, 8192);
    if (sample.includes("\0")) {
      return res.json({ path: relativePath, binary: true, language: "plaintext" });
    }

    res.json({ path: relativePath, content, language: detectLanguage(relativePath) });
  } catch (err) {
    if (err.code === "ENOENT") return res.status(404).json({ error: "File not found" });
    console.error(`[api] GET /api/agents/${req.params.id}/file failed:`, err);
    res.status(500).json({ error: err.message || "Failed to read file" });
  }
});

app.put("/api/agents/:id/file", async (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });

  const { path: relativePath, content } = req.body;
  if (!relativePath) return res.status(400).json({ error: "path is required" });
  if (content === undefined || content === null) return res.status(400).json({ error: "content is required" });

  const resolved = resolveAgentPath(agent, relativePath);
  if (!resolved) return res.status(400).json({ error: "Invalid path" });

  // Prevent writing inside .git directory
  const relNormalized = path.relative(agent.workingDirectory, resolved);
  if (relNormalized.startsWith(".git/") || relNormalized === ".git") {
    return res.status(400).json({ error: "Cannot write to .git directory" });
  }

  try {
    await fs.promises.writeFile(resolved, content, "utf-8");
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "ENOENT") return res.status(404).json({ error: "File not found" });
    console.error(`[api] PUT /api/agents/${req.params.id}/file failed:`, err);
    res.status(500).json({ error: err.message || "Failed to write file" });
  }
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
  await execPromise("git", ["fetch", "--all", "--prune"], { cwd, timeout: 15000 }).catch((err) => {
    console.error(`[api] git fetch --all --prune failed in ${cwd} (continuing):`, err.message);
  });

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

  // Also include worktree mapping so UI knows which branches already have worktrees
  const mainDir = await getMainWorktreeDir(cwd);
  const wts = mainDir ? await listWorktrees(mainDir) : [];
  const worktreeMap = {};
  for (const wt of wts) {
    if (wt.branch) worktreeMap[wt.branch] = wt.path;
  }

  res.json({
    current: currentBranch || "HEAD",
    branches: [
      ...local.map((b) => ({ name: b, local: true })),
      ...remoteOnly.map((b) => ({ name: b, local: false })),
    ],
    worktrees: worktreeMap,
  });
});

app.delete("/api/agents/:id/branches/local", async (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });

  const cwd = agent.workingDirectory;
  try {
    // Get current branch to avoid deleting it
    const currentBranch = await gitExec(["rev-parse", "--abbrev-ref", "HEAD"], cwd);

    // Get the default branch (usually main or master)
    let defaultBranch = null;
    try {
      const originHead = await gitExec(["symbolic-ref", "refs/remotes/origin/HEAD", "--short"], cwd);
      defaultBranch = originHead ? originHead.replace(/^origin\//, "") : null;
    } catch {
      // Fallback: check if main or master exists
      const localBranches = await gitExec(["branch", "--format=%(refname:short)"], cwd);
      const locals = localBranches ? localBranches.split("\n").filter(Boolean) : [];
      if (locals.includes("main")) defaultBranch = "main";
      else if (locals.includes("master")) defaultBranch = "master";
    }

    // Get all local branches
    const localRaw = await gitExec(["branch", "--format=%(refname:short)"], cwd);
    const local = localRaw ? localRaw.split("\n").filter(Boolean) : [];

    // Get branches that have active worktrees (can't delete those)
    const mainDir = await getMainWorktreeDir(cwd);
    const wts = mainDir ? await listWorktrees(mainDir) : [];
    const worktreeBranches = new Set(wts.map((wt) => wt.branch).filter(Boolean));

    // Filter out current, default, and worktree branches
    const protectedBranches = new Set([currentBranch, defaultBranch].filter(Boolean));
    const toDelete = local.filter((b) => !protectedBranches.has(b) && !worktreeBranches.has(b));

    if (toDelete.length === 0) {
      return res.json({ ok: true, deleted: [], skipped: [], message: "No branches to delete" });
    }

    const deleted = [];
    const skipped = [];
    for (const branch of toDelete) {
      try {
        await execPromise("git", ["branch", "-D", branch], { cwd, timeout: 5000 });
        deleted.push(branch);
      } catch (err) {
        console.error(`[api] Failed to delete local branch "${branch}":`, err.message);
        skipped.push({ branch, reason: err.message || "Failed to delete" });
      }
    }

    res.json({ ok: true, deleted, skipped });
  } catch (err) {
    console.error("[api] Delete local branches failed:", err);
    res.status(400).json({ error: err.message || "Failed to delete local branches" });
  }
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
    console.error(`[api] Checkout branch "${branch}" failed:`, err);
    res.status(400).json({ error: err.message || "Failed to checkout branch" });
  }
});

// --- Worktree endpoints ---

app.get("/api/agents/:id/worktrees", async (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });

  const cwd = agent.workingDirectory;
  const mainDir = await getMainWorktreeDir(cwd);
  if (!mainDir) {
    return res.status(400).json({ error: "Not a git repository" });
  }

  const wts = await listWorktrees(mainDir);
  res.json({
    mainDir,
    worktrees: wts.map((wt) => ({
      branch: wt.branch,
      path: wt.path,
      isMain: wt.isMain,
    })),
  });
});

app.post("/api/agents/:id/worktree", async (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });

  const { branch: rawBranch, createBranch } = req.body;
  const branch = rawBranch?.trim();
  if (!branch) {
    return res.status(400).json({ error: "branch is required" });
  }

  const cwd = agent.workingDirectory;
  const mainDir = await getMainWorktreeDir(cwd);
  if (!mainDir) {
    return res.status(400).json({ error: "Not a git repository" });
  }

  // Check if a worktree for this branch already exists
  const existing = await listWorktrees(mainDir);
  if (existing.some((wt) => wt.branch === branch)) {
    return res.status(409).json({ error: `Worktree for branch "${branch}" already exists` });
  }

  const targetPath = buildWorktreePath(mainDir, branch);
  const result = await addWorktree(mainDir, branch, targetPath, !!createBranch);
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }

  // Auto-create an agent for the new worktree
  const projectName = path.basename(mainDir);
  const agentName = `${projectName} (${branch})`;
  const profileId = agent.profileId;
  const newAgent = createAgent(agentName, targetPath, profileId);

  res.status(201).json({
    agent: {
      id: newAgent.id,
      name: newAgent.name,
      workingDirectory: newAgent.workingDirectory,
      status: newAgent.status,
      profileId: newAgent.profileId,
    },
    worktree: {
      branch,
      path: targetPath,
      isMain: false,
    },
  });
});

app.delete("/api/agents/:id/worktree", async (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });

  const cwd = agent.workingDirectory;
  const mainDir = await getMainWorktreeDir(cwd);
  if (!mainDir) {
    return res.status(400).json({ error: "Not a git repository" });
  }

  // Don't allow removing the main worktree
  if (cwd === mainDir) {
    return res.status(400).json({ error: "Cannot remove the main worktree. Delete the project instead." });
  }

  // Abort agent if busy
  if (agent.status === "busy") {
    abortAgent(req.params.id);
  }

  // Remove the worktree
  const result = await removeWorktree(mainDir, cwd);
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }

  // Delete the agent
  deleteAgent(req.params.id);

  res.status(204).end();
});

app.patch("/api/agents/:id/settings", (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  if (req.body.interactiveQuestions !== undefined) {
    setInteractiveQuestions(req.params.id, req.body.interactiveQuestions);
  }
  if (req.body.model !== undefined) {
    setAgentModel(req.params.id, req.body.model);
  }
  res.json({ interactiveQuestions: agent.interactiveQuestions, model: agent.model || null });
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

  const allAccounts = readProviders(profileId);

  // Return flat accounts list (never expose actual tokens)
  const accounts = allAccounts.map((a) => {
    const safe = { id: a.id, label: a.label || "", type: a.type, hasToken: !!a.token };
    if (a.type === "gitlab") safe.url = a.url || "https://gitlab.com";
    if (a.type === "azuredevops") safe.organization = a.organization || "";
    return safe;
  });

  res.json({
    name: name || "",
    email: email || "",
    hasToken: accounts.some((a) => a.hasToken), // backward compat
    accounts,
  });
});

app.post("/api/git-config", async (req, res) => {
  const profileId = req.profile?.id || null;
  const gitDir = getGitDir(profileId);
  const gitconfigPath = path.join(gitDir, "gitconfig");
  const { name, email, accounts: incomingAccounts } = req.body;

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

  // Update accounts if provided
  const changedTypes = new Set();

  if (Array.isArray(incomingAccounts)) {
    const existing = readProviders(profileId);
    const existingById = new Map(existing.map((a) => [a.id, a]));
    const newList = [];

    for (const incoming of incomingAccounts) {
      if (incoming.id && existingById.has(incoming.id)) {
        // Update existing account
        const old = existingById.get(incoming.id);
        const updated = { ...old };
        if (incoming.label !== undefined) updated.label = incoming.label;
        if (incoming.type !== undefined) updated.type = incoming.type;
        if (incoming.token && incoming.token.trim()) {
          if (old.token !== incoming.token.trim()) changedTypes.add(updated.type);
          updated.token = incoming.token.trim();
        }
        if (incoming.url !== undefined && updated.type === "gitlab") {
          if (old.url !== incoming.url) changedTypes.add("gitlab");
          updated.url = incoming.url;
        }
        if (incoming.organization !== undefined && updated.type === "azuredevops") {
          if (old.organization !== incoming.organization) changedTypes.add("azuredevops");
          updated.organization = incoming.organization;
        }
        newList.push(updated);
        existingById.delete(incoming.id);
      } else {
        // New account
        const account = {
          id: incoming.id || crypto.randomUUID(),
          label: incoming.label || "Account",
          token: (incoming.token || "").trim(),
          type: incoming.type || "github",
        };
        if (account.type === "gitlab") account.url = incoming.url || "https://gitlab.com";
        if (account.type === "azuredevops") account.organization = incoming.organization || "";
        newList.push(account);
        if (account.token) changedTypes.add(account.type);
      }
    }

    // Any remaining in existingById were deleted
    for (const deleted of existingById.values()) {
      if (deleted.token) changedTypes.add(deleted.type);
    }

    writeProviders(newList, profileId);
  }

  syncGitCredentials(profileId);

  // Update remote URLs in existing workspace repos (fire-and-forget)
  const changed = [...changedTypes];
  if (changed.length > 0) {
    updateRemoteUrls(profileId, changed).catch((err) => {
      console.error("[git-config] Failed to update remote URLs:", err.message);
    });
  }

  // Return updated state (same shape as GET /api/git-config)
  const [updatedName, updatedEmail] = await Promise.all([
    gitExec(["config", "--file", gitconfigPath, "--get", "user.name"], "/"),
    gitExec(["config", "--file", gitconfigPath, "--get", "user.email"], "/"),
  ]);

  const allAccounts = readProviders(profileId);
  const safeAccounts = allAccounts.map((a) => {
    const safe = { id: a.id, label: a.label || "", type: a.type, hasToken: !!a.token };
    if (a.type === "gitlab") safe.url = a.url || "https://gitlab.com";
    if (a.type === "azuredevops") safe.organization = a.organization || "";
    return safe;
  });

  res.json({
    name: updatedName || "",
    email: updatedEmail || "",
    hasToken: safeAccounts.some((a) => a.hasToken),
    accounts: safeAccounts,
  });
});

// --- Suggestion endpoints ---
import {
  initSuggestions,
  listSuggestions,
  getSuggestion,
  createSuggestion,
  updateSuggestion,
  deleteSuggestion,
  reorderSuggestions,
  KNOWN_CONTEXT_TAGS,
} from "./suggestions.js";

app.get("/api/suggestions", (req, res) => {
  const profileId = req.profile?.id || null;
  res.json(listSuggestions(profileId));
});

app.post("/api/suggestions", (req, res) => {
  const profileId = req.profile?.id || null;
  const { name, description, actionType, actionValue, contextTags, order, enabled } = req.body;

  if (!name || !name.trim()) return res.status(400).json({ error: "name is required" });
  if (!actionType || !["prompt", "skill", "platform"].includes(actionType)) {
    return res.status(400).json({ error: "actionType must be one of: prompt, skill, platform" });
  }
  if (!actionValue || !actionValue.trim()) return res.status(400).json({ error: "actionValue is required" });
  if (name.trim().length > 50) return res.status(400).json({ error: "name must be 50 characters or less" });
  if (contextTags && !Array.isArray(contextTags)) return res.status(400).json({ error: "contextTags must be an array" });

  try {
    const suggestion = createSuggestion(profileId, {
      name: name.trim(),
      description: description || "",
      actionType,
      actionValue: actionValue.trim(),
      contextTags: contextTags || [],
      order,
      enabled,
    });
    res.status(201).json(suggestion);
  } catch (err) {
    console.error("[api] POST /api/suggestions failed:", err);
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/suggestions/meta/context-tags", (_req, res) => {
  res.json(KNOWN_CONTEXT_TAGS);
});

app.put("/api/suggestions/reorder", (req, res) => {
  const profileId = req.profile?.id || null;
  const { orderedIds } = req.body;

  if (!Array.isArray(orderedIds)) return res.status(400).json({ error: "orderedIds must be an array" });

  const result = reorderSuggestions(profileId, orderedIds);
  res.json(result);
});

app.get("/api/suggestions/:id", (req, res) => {
  const profileId = req.profile?.id || null;
  const suggestion = getSuggestion(profileId, req.params.id);
  if (!suggestion) return res.status(404).json({ error: "Suggestion not found" });
  res.json(suggestion);
});

app.put("/api/suggestions/:id", (req, res) => {
  const profileId = req.profile?.id || null;
  const suggestion = getSuggestion(profileId, req.params.id);
  if (!suggestion) return res.status(404).json({ error: "Suggestion not found" });

  const { name, actionType } = req.body;
  if (name !== undefined && (!name || !name.trim())) return res.status(400).json({ error: "name cannot be empty" });
  if (name && name.trim().length > 50) return res.status(400).json({ error: "name must be 50 characters or less" });
  if (actionType && !["prompt", "skill", "platform"].includes(actionType)) {
    return res.status(400).json({ error: "actionType must be one of: prompt, skill, platform" });
  }

  const updated = updateSuggestion(profileId, req.params.id, req.body);
  res.json(updated);
});

app.delete("/api/suggestions/:id", (req, res) => {
  const profileId = req.profile?.id || null;
  const suggestion = getSuggestion(profileId, req.params.id);
  if (!suggestion) return res.status(404).json({ error: "Suggestion not found" });
  if (suggestion.builtIn) return res.status(400).json({ error: "Cannot delete built-in suggestions. Disable them instead." });

  deleteSuggestion(profileId, req.params.id);
  res.status(204).end();
});

// --- Task endpoints ---
import {
  createTask,
  listTasks as listAllTasks,
  getTask,
  updateTask as updateTaskData,
  deleteTask as deleteTaskData,
  toggleTask,
  triggerTask,
  stopTask,
  isRunning,
  getRunHistory,
  getRunDetail,
  getAllRuns,
  validateCron,
  getNextRuns,
  startTaskScheduler,
  onRunComplete,
  generateWebhookToken,
  revokeWebhookToken,
  getTaskByWebhookToken,
  getRunArtifacts,
  getRunArtifactPath,
  getWorkspaceSummaryPath,
} from "./tasks.js";

app.get("/api/tasks", (req, res) => {
  const profileId = req.profile?.id || null;
  const items = listAllTasks(profileId);
  // Add running status
  res.json(items.map((t) => ({ ...t, running: isRunning(t.id) })));
});

app.post("/api/tasks", (req, res) => {
  const profileId = req.profile?.id || null;
  const { name, cronExpression, workingDirectory, prompt, model, emails } = req.body;

  if (!name || !name.trim()) return res.status(400).json({ error: "name is required" });
  if (!workingDirectory) return res.status(400).json({ error: "workingDirectory is required" });
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: "prompt is required" });

  // Validate cron if provided
  if (cronExpression) {
    const cronValid = validateCron(cronExpression);
    if (!cronValid.valid) return res.status(400).json({ error: `Invalid cron expression: ${cronValid.error}` });
  }

  // Validate working directory exists
  const ctx = getProfileContext(req);
  if (!workingDirectory.startsWith(ctx.workspaceRoot)) {
    return res.status(400).json({ error: "workingDirectory must be within the workspace" });
  }

  const webhookBaseUrl = `${BASE_URL_PROTOCOL}://${req.get("host")}`;
  const task = createTask(profileId, { name: name.trim(), cronExpression: cronExpression || null, workingDirectory, prompt: prompt.trim(), model: model || null, emails: emails || [], webhookBaseUrl });
  res.status(201).json(task);
});

app.get("/api/tasks/runs", (req, res) => {
  const profileId = req.profile?.id || null;
  const limit = parseInt(req.query.limit) || 50;
  res.json(getAllRuns(profileId, limit));
});

app.get("/api/tasks/:id", (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  res.json({ ...task, running: isRunning(task.id) });
});

app.put("/api/tasks/:id", (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });

  const { cronExpression, workingDirectory } = req.body;
  if (cronExpression) {
    const cronValid = validateCron(cronExpression);
    if (!cronValid.valid) return res.status(400).json({ error: `Invalid cron expression: ${cronValid.error}` });
  }

  // Validate working directory if provided
  if (workingDirectory) {
    const ctx = getProfileContext(req);
    if (!workingDirectory.startsWith(ctx.workspaceRoot)) {
      return res.status(400).json({ error: "workingDirectory must be within the workspace" });
    }
  }

  const updated = updateTaskData(req.params.id, { ...req.body, webhookBaseUrl: `${BASE_URL_PROTOCOL}://${req.get("host")}` });
  res.json({ ...updated, running: isRunning(updated.id) });
});

app.delete("/api/tasks/:id", (req, res) => {
  const deleted = deleteTaskData(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Task not found" });
  res.status(204).end();
});

app.patch("/api/tasks/:id/toggle", (req, res) => {
  const { enabled } = req.body;
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  if (!task.cronExpression) return res.status(400).json({ error: "Cannot toggle a task without a schedule" });
  const toggled = toggleTask(req.params.id, enabled);
  res.json({ ...toggled, running: isRunning(toggled.id) });
});

app.post("/api/tasks/:id/trigger", (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  const result = triggerTask(req.params.id);
  if (!result) return res.status(409).json({ error: "Task is already running" });
  const baseUrl = `${BASE_URL_PROTOCOL}://${req.get("host")}`;
  const summaryUrl = `${baseUrl}/api/tasks/${req.params.id}/runs/${result.runId}/summary`;
  res.json({ ok: true, message: "Task triggered", runId: result.runId, summaryUrl, summaryFilename: result.summaryFilename });
});

app.post("/api/tasks/:id/stop", (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  if (!isRunning(req.params.id)) return res.status(409).json({ error: "Task is not running" });

  const result = stopTask(req.params.id);
  if (!result.stopped) {
    return res.status(409).json({ error: `Cannot stop task: ${result.reason}` });
  }
  res.json({ ok: true, message: "Task stop signal sent" });
});

app.get("/api/tasks/:id/runs", (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  const limit = parseInt(req.query.limit) || 20;
  res.json(getRunHistory(req.params.id, limit));
});

app.get("/api/tasks/:id/runs/:runId", (req, res) => {
  const detail = getRunDetail(req.params.id, req.params.runId);
  if (!detail) return res.status(404).json({ error: "Run not found" });
  res.json(detail);
});

// Authenticated summary endpoint — serves from .claude-tasks/ in workspace (with fallback)
app.get("/api/tasks/:id/runs/:runId/summary", (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });

  // Look up the summaryFilename from the run detail
  const detail = getRunDetail(req.params.id, req.params.runId);
  if (detail?.summaryFilename) {
    const wsPath = getWorkspaceSummaryPath(req.params.id, detail.summaryFilename);
    if (wsPath) return sendSummaryFile(res, wsPath, task.name);
  }

  // Fallback to archived summary.md
  const filePath = getRunArtifactPath(req.params.id, req.params.runId, "summary.md");
  if (!filePath) return res.status(404).json({ error: "Summary not found" });
  sendSummaryFile(res, filePath, task.name);
});

app.get("/api/tasks/:id/runs/:runId/artifacts", (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  const artifacts = getRunArtifacts(req.params.id, req.params.runId);
  res.json(artifacts || []);
});

app.get("/api/tasks/:id/runs/:runId/artifacts/:filename", (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  const filePath = getRunArtifactPath(req.params.id, req.params.runId, req.params.filename);
  if (!filePath) return res.status(404).json({ error: "Artifact not found" });
  res.sendFile(filePath, { dotfiles: "allow" });
});

app.post("/api/tasks/validate-cron", (req, res) => {
  const { cronExpression } = req.body;
  if (!cronExpression) return res.status(400).json({ error: "cronExpression is required" });
  const result = validateCron(cronExpression);
  if (result.valid) {
    res.json({ valid: true, nextRuns: getNextRuns(cronExpression, 5) });
  } else {
    res.json({ valid: false, error: result.error });
  }
});

// Webhook token management
app.post("/api/tasks/:id/webhook-token", (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  const baseUrl = `${BASE_URL_PROTOCOL}://${req.get("host")}`;
  const token = generateWebhookToken(req.params.id, baseUrl);
  const webhookUrl = `${baseUrl}/api/webhooks/tasks/${req.params.id}/${token}`;
  res.json({ webhookToken: token, webhookUrl });
});

app.delete("/api/tasks/:id/webhook-token", (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  revokeWebhookToken(req.params.id);
  res.status(204).end();
});

// SPA fallback (Express 5 requires named wildcard)
app.get("{*path}", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "dist", "index.html"));
});

// WebSocket
const wss = new WebSocketServer({ noServer: true, maxPayload: 50 * 1024 * 1024 });

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
  const pendingMessages = new Map(); // agentId -> Array of queued message texts (FIFO)

  // Send boot ID so clients can detect server restarts
  ws.send(JSON.stringify({ type: "welcome", bootId }));

  ws.on("message", async (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      console.error("[ws] Invalid JSON from client:", err.message);
      ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
      return;
    }

    if (data.type === "abort" && data.agentId) {
      // Clear all queued pending messages when aborting
      pendingMessages.delete(data.agentId);
      abortAgent(data.agentId);
      return;
    }

    if (data.type === "cancel_pending" && data.agentId) {
      pendingMessages.delete(data.agentId);
      return;
    }

    if (data.type === "cancel_pending_one" && data.agentId && data.index != null) {
      const queue = pendingMessages.get(data.agentId);
      if (queue && data.index >= 0 && data.index < queue.length) {
        queue.splice(data.index, 1);
        if (queue.length === 0) pendingMessages.delete(data.agentId);
      }
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

    if (data.type === "message" && data.agentId && (data.text || data.attachments)) {
      const agent = getAgent(data.agentId);

      // If agent is busy, push message onto the FIFO queue
      if (agent && agent.status === "busy") {
        let queue = pendingMessages.get(data.agentId);
        if (!queue) {
          queue = [];
          pendingMessages.set(data.agentId, queue);
        }
        queue.push({ text: data.text || "", attachments: data.attachments || null });
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: "message_queued", agentId: data.agentId, text: data.text || "", queueLength: queue.length }));
        }
        return;
      }

      // Process message and then drain queued follow-ups in FIFO order
      async function processMessage(text, attachments) {
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
          await sendMessage(data.agentId, text, attachments);
        } catch (err) {
          console.error(`[ws] sendMessage failed for agent ${data.agentId}:`, err);
          if (ws.readyState === ws.OPEN) {
            ws.send(
              JSON.stringify({ type: "error", agentId: data.agentId, message: err.message })
            );
          }
        } finally {
          unsubscribeAgent(data.agentId, listener);
          connectionListeners.delete(data.agentId);
        }

        // After message completes, drain the next queued message (FIFO)
        const queue = pendingMessages.get(data.agentId);
        if (queue && queue.length > 0 && ws.readyState === ws.OPEN) {
          const next = queue.shift();
          if (queue.length === 0) pendingMessages.delete(data.agentId);
          // Notify client the next pending message is now being sent
          ws.send(JSON.stringify({ type: "message_dequeued", agentId: data.agentId, text: next.text }));
          // Process the next queued message
          await processMessage(next.text, next.attachments);
        }
      }

      await processMessage(data.text || "", data.attachments || null);
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
    pendingMessages.clear();
    killAllTerminals(connectionTerminals);
    connectionTerminals.clear();
  });
});

// --- Express error-handling middleware (must be registered last) ---
// Catches errors thrown synchronously or passed to next(err) from any route.
// Logs the full error to stderr so it surfaces in `docker logs`.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error(`[express] Unhandled error on ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) {
    return;
  }
  res.status(err.status || 500).json({
    error: err.message || "Internal server error",
  });
});

const PORT = process.env.PORT || 3001;
server.on("error", (err) => {
  console.error(`[server] HTTP server error:`, err);
});
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Claude Web UI running on http://0.0.0.0:${PORT}`);
  // Initialize suggestions for all profiles
  const allProfiles = listProfiles();
  for (const profile of allProfiles) {
    initSuggestions(profile.id);
  }
  // Start the task scheduler after server is ready
  startTaskScheduler();
});

// Broadcast task run completions to connected WebSocket clients
onRunComplete(({ taskId, runId, task, runEntry }) => {
  const msg = JSON.stringify({
    type: "task_run_complete",
    taskId,
    runId,
    taskName: task.name,
    status: runEntry.status,
  });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      try {
        client.send(msg);
      } catch (err) {
        console.error("[ws] Failed to broadcast task_run_complete:", err);
      }
    }
  }
});

// Send email notifications on task run completion
onRunComplete(async ({ taskId, runId, task, runEntry }) => {
  try {
    if (!task.emails || task.emails.length === 0) return;
    if (!task.webhookToken) return; // Need webhook token for public URL
    if (!task.webhookBaseUrl) {
      console.warn(`[email] No webhookBaseUrl stored for task "${task.name}", skipping email`);
      return;
    }

    const summaryUrl = `${task.webhookBaseUrl}/api/webhooks/tasks/${taskId}/${task.webhookToken}/runs/${runId}/summary?render=true`;

    await sendTaskCompletionEmail(task.profileId, task, runEntry, summaryUrl);
  } catch (err) {
    console.error(`[email] Failed to send notification for task "${task.name}":`, err.message);
  }
});
