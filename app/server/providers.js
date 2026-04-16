import fs from "fs";
import path from "path";
import https from "https";
import crypto from "crypto";
import { execFile } from "child_process";
import { getProfilePaths } from "./profiles.js";

const LEGACY_GIT_DIR = "/home/node/.claude/git";

export function getGitDir(profileId) {
  if (profileId) {
    const paths = getProfilePaths(profileId);
    return paths ? paths.gitDir : LEGACY_GIT_DIR;
  }
  return LEGACY_GIT_DIR;
}

/* ------------------------------------------------------------------ */
/*  Data model — flat array of accounts                                */
/*                                                                     */
/*  providers.json = [                                                 */
/*    { id, label, token, type: "github" },                           */
/*    { id, label, token, type: "github" },                           */
/*    { id, label, token, type: "gitlab", url: "..." },               */
/*    { id, label, token, type: "azuredevops", organization: "..." }, */
/*  ]                                                                  */
/* ------------------------------------------------------------------ */

/**
 * Migrate legacy formats to the flat array.
 *
 * Handles two legacy shapes:
 *  1. Original single-token: { github: { token }, gitlab: { token, url }, ... }
 *  2. Previous multi-account: { github: { accounts: [...], defaultAccountId }, ... }
 *
 * Returns the (possibly migrated) array. The caller persists if needed.
 */
function migrateProviders(raw) {
  // Already the new flat array format
  if (Array.isArray(raw)) return { accounts: raw, migrated: false };

  // It's an object — legacy format. Convert.
  const accounts = [];

  for (const type of ["github", "gitlab", "azuredevops"]) {
    const entry = raw[type];
    if (!entry) continue;

    if (entry.accounts && Array.isArray(entry.accounts)) {
      // Previous multi-account format: { accounts: [...], defaultAccountId }
      for (const a of entry.accounts) {
        const account = {
          id: a.id || crypto.randomUUID(),
          label: a.label || "Default",
          token: a.token || "",
          type,
        };
        if (type === "gitlab") account.url = a.url || "https://gitlab.com";
        if (type === "azuredevops") account.organization = a.organization || "";
        accounts.push(account);
      }
    } else if (entry.token) {
      // Original single-token format: { token, url?, organization? }
      const account = {
        id: crypto.randomUUID(),
        label: "Default",
        token: entry.token,
        type,
      };
      if (type === "gitlab") account.url = entry.url || "https://gitlab.com";
      if (type === "azuredevops") account.organization = entry.organization || "";
      accounts.push(account);
    }
  }

  return { accounts, migrated: true };
}

export function readProviders(profileId) {
  const gitDir = getGitDir(profileId);
  const providersPath = path.join(gitDir, "providers.json");
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(providersPath, "utf-8"));
  } catch {
    return [];
  }
  const { accounts, migrated } = migrateProviders(raw);
  if (migrated) {
    try {
      fs.writeFileSync(providersPath, JSON.stringify(accounts, null, 2), { mode: 0o600 });
    } catch { /* best effort */ }
  }
  return accounts;
}

export function writeProviders(accounts, profileId) {
  const gitDir = getGitDir(profileId);
  fs.mkdirSync(gitDir, { recursive: true });
  fs.writeFileSync(path.join(gitDir, "providers.json"), JSON.stringify(accounts, null, 2), { mode: 0o600 });
}

/* ------------------------------------------------------------------ */
/*  Account accessors                                                  */
/* ------------------------------------------------------------------ */

/** Get a specific account by ID. */
export function getAccountById(accountId, profileId) {
  const accounts = readProviders(profileId);
  return accounts.find((a) => a.id === accountId) || null;
}

/** Get all accounts for a given provider type. */
export function getAllAccounts(type, profileId) {
  const accounts = readProviders(profileId);
  return accounts.filter((a) => a.type === type);
}

/** Get the first account for a provider type (used as default/fallback). */
export function getDefaultAccount(type, profileId) {
  const accounts = getAllAccounts(type, profileId);
  return accounts[0] || null;
}

/** Build a backward-compatible config object from an account. */
function accountToConfig(account) {
  if (!account) return {};
  if (account.type === "gitlab") return { token: account.token, url: account.url || "https://gitlab.com" };
  if (account.type === "azuredevops") return { token: account.token, organization: account.organization || "" };
  return { token: account.token };
}

/** Get provider config for a specific account (by ID). */
export function getProviderConfigByAccountId(accountId, profileId) {
  return accountToConfig(getAccountById(accountId, profileId));
}

/* ------------------------------------------------------------------ */
/*  Backward-compatible accessors (use first account of the type)      */
/* ------------------------------------------------------------------ */

export function getProviderToken(type, profileId) {
  const account = getDefaultAccount(type, profileId);
  return account?.token || null;
}

export function getProviderConfig(type, profileId) {
  return accountToConfig(getDefaultAccount(type, profileId));
}

/* ------------------------------------------------------------------ */
/*  Git credentials sync (writes ALL accounts)                         */
/* ------------------------------------------------------------------ */

export function syncGitCredentials(profileId) {
  const gitDir = getGitDir(profileId);
  const accounts = readProviders(profileId);
  const lines = [];

  for (const account of accounts) {
    if (!account.token) continue;
    if (account.type === "github") {
      lines.push(`https://${account.token}@github.com`);
    } else if (account.type === "gitlab") {
      const host = (account.url || "https://gitlab.com").replace(/^https?:\/\//, "");
      lines.push(`https://oauth2:${account.token}@${host}`);
    } else if (account.type === "azuredevops") {
      lines.push(`https://azuredevops:${account.token}@dev.azure.com`);
    }
  }

  fs.writeFileSync(path.join(gitDir, "git-credentials"), lines.join("\n") + (lines.length ? "\n" : ""), { mode: 0o600 });
}

/* ------------------------------------------------------------------ */
/*  HTTP / API helpers (unchanged)                                     */
/* ------------------------------------------------------------------ */

export function apiRequest(method, hostname, apiPath, headers, body) {
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

export function githubApi(method, apiPath, token, body) {
  return apiRequest(method, "api.github.com", apiPath, {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github.v3+json",
  }, body);
}

export function gitlabApi(method, apiPath, token, gitlabUrl, body) {
  const host = (gitlabUrl || "https://gitlab.com").replace(/^https?:\/\//, "");
  return apiRequest(method, host, apiPath, {
    "PRIVATE-TOKEN": token,
  }, body);
}

export function azureDevOpsApi(method, org, apiPath, token, body) {
  const auth = Buffer.from(`:${token}`).toString("base64");
  return apiRequest(method, "dev.azure.com", `/${org}${apiPath}`, {
    Authorization: `Basic ${auth}`,
  }, body);
}

export function execPromise(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

export function gitExec(args, cwd) {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: 5000 }, (err, stdout) => {
      if (err) resolve(null);
      else resolve(stdout.trim());
    });
  });
}

export function gitEnvForProfile(profileId) {
  const gitDir = getGitDir(profileId);
  return {
    GIT_CONFIG_GLOBAL: path.join(gitDir, "gitconfig"),
  };
}

export async function configureLocalGit(dir, profileId) {
  const gitDir = getGitDir(profileId);
  const gitconfigPath = path.join(gitDir, "gitconfig");
  const [globalName, globalEmail] = await Promise.all([
    gitExec(["config", "--file", gitconfigPath, "--get", "user.name"], "/"),
    gitExec(["config", "--file", gitconfigPath, "--get", "user.email"], "/"),
  ]);
  if (globalName) await execPromise("git", ["config", "user.name", globalName], { cwd: dir });
  if (globalEmail) await execPromise("git", ["config", "user.email", globalEmail], { cwd: dir });
}

/* ------------------------------------------------------------------ */
/*  Remote URL parsing — checks all GitLab account URLs                */
/* ------------------------------------------------------------------ */

export function parseRemoteUrl(remoteUrl, profileId) {
  let m;
  m = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (m) return { provider: "github", owner: m[1], repo: m[2] };
  m = remoteUrl.match(/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/.]+)/);
  if (m) return { provider: "azuredevops", org: m[1], project: m[2], repo: m[3] };

  // Check all GitLab accounts for URL matches
  const glAccounts = getAllAccounts("gitlab", profileId);
  const checkedHosts = new Set();
  for (const account of glAccounts) {
    const glHost = (account.url || "https://gitlab.com").replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (checkedHosts.has(glHost)) continue;
    checkedHosts.add(glHost);
    const glRe = new RegExp(glHost.replace(/\./g, "\\.") + "[:/]([^/]+)/([^/.]+)");
    m = remoteUrl.match(glRe);
    if (m) return { provider: "gitlab", owner: m[1], repo: m[2], host: glHost };
  }

  // Fallback to gitlab.com
  if (!checkedHosts.has("gitlab.com")) {
    m = remoteUrl.match(/gitlab\.com[:/]([^/]+)\/([^/.]+)/);
    if (m) return { provider: "gitlab", owner: m[1], repo: m[2], host: "gitlab.com" };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  PR/MR info — tries all accounts for the provider                   */
/* ------------------------------------------------------------------ */

export async function fetchPrInfo(remote, branch, profileId) {
  if (remote.provider === "github") {
    const accounts = getAllAccounts("github", profileId);
    for (const account of accounts) {
      if (!account.token) continue;
      try {
        const result = await githubApi("GET", `/repos/${remote.owner}/${remote.repo}/pulls?state=open&head=${remote.owner}:${branch}`, account.token);
        if (result.status === 200 && result.data.length > 0) {
          const pr = result.data[0];
          return { provider: "github", number: pr.number, title: pr.title, url: pr.html_url, owner: remote.owner, repo: remote.repo };
        }
      } catch { /* try next account */ }
    }
  } else if (remote.provider === "gitlab") {
    const accounts = getAllAccounts("gitlab", profileId);
    for (const account of accounts) {
      if (!account.token) continue;
      try {
        const projectPath = encodeURIComponent(`${remote.owner}/${remote.repo}`);
        const result = await gitlabApi("GET", `/api/v4/projects/${projectPath}/merge_requests?state=opened&source_branch=${encodeURIComponent(branch)}`, account.token, account.url);
        if (result.status === 200 && result.data.length > 0) {
          const mr = result.data[0];
          return { provider: "gitlab", number: mr.iid, title: mr.title, url: mr.web_url, projectPath };
        }
      } catch { /* try next account */ }
    }
  } else if (remote.provider === "azuredevops") {
    const accounts = getAllAccounts("azuredevops", profileId);
    for (const account of accounts) {
      if (!account.token || !account.organization) continue;
      try {
        const result = await azureDevOpsApi("GET", account.organization,
          `/${remote.project}/_apis/git/repositories/${remote.repo}/pullrequests?searchCriteria.sourceRefName=refs/heads/${encodeURIComponent(branch)}&searchCriteria.status=active&api-version=7.0`,
          account.token);
        if (result.status === 200 && result.data.value?.length > 0) {
          const pr = result.data.value[0];
          return {
            provider: "azuredevops", number: pr.pullRequestId, title: pr.title,
            url: `https://dev.azure.com/${account.organization}/${remote.project}/_git/${remote.repo}/pullrequest/${pr.pullRequestId}`,
            org: account.organization, project: remote.project, repo: remote.repo,
          };
        }
      } catch { /* try next account */ }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Clone URL builder — supports optional accountId                    */
/* ------------------------------------------------------------------ */

export function buildCloneUrl(type, repoFullName, profileId, accountId) {
  const config = accountId
    ? getProviderConfigByAccountId(accountId, profileId)
    : getProviderConfig(type, profileId);

  if (type === "github") {
    return `https://${config.token}@github.com/${repoFullName}.git`;
  } else if (type === "gitlab") {
    const host = (config.url || "https://gitlab.com").replace(/^https?:\/\//, "");
    return `https://oauth2:${config.token}@${host}/${repoFullName}.git`;
  } else if (type === "azuredevops") {
    const [project, repo] = repoFullName.split("/");
    return `https://azuredevops:${config.token}@dev.azure.com/${config.organization}/${project}/_git/${repo}`;
  }
  throw new Error(`Unknown provider: ${type}`);
}

/**
 * Update remote origin URLs in all workspace repos after a token change.
 */
export async function updateRemoteUrls(profileId, changedProviders) {
  if (!changedProviders || changedProviders.length === 0) return;

  let workspaceRoot;
  if (profileId) {
    const paths = getProfilePaths(profileId);
    if (!paths) return;
    workspaceRoot = paths.workspaceRoot;
  } else {
    workspaceRoot = "/workspace";
  }

  let entries;
  try {
    entries = await fs.promises.readdir(workspaceRoot, { withFileTypes: true });
  } catch {
    return;
  }

  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => path.join(workspaceRoot, e.name));

  const changedSet = new Set(changedProviders);

  await Promise.all(
    dirs.map(async (dir) => {
      try {
        const gitPath = path.join(dir, ".git");
        let stat;
        try {
          stat = await fs.promises.stat(gitPath);
        } catch {
          return;
        }
        if (stat.isFile()) return;

        const remoteUrl = await gitExec(["remote", "get-url", "origin"], dir);
        if (!remoteUrl) return;
        if (!remoteUrl.startsWith("https://")) return;

        const remote = parseRemoteUrl(remoteUrl, profileId);
        if (!remote || !changedSet.has(remote.provider)) return;

        const token = getProviderToken(remote.provider, profileId);
        if (!token) return;

        let repoFullName;
        if (remote.provider === "github") {
          repoFullName = `${remote.owner}/${remote.repo}`;
        } else if (remote.provider === "gitlab") {
          repoFullName = `${remote.owner}/${remote.repo}`;
        } else if (remote.provider === "azuredevops") {
          repoFullName = `${remote.project}/${remote.repo}`;
        } else {
          return;
        }

        const newUrl = buildCloneUrl(remote.provider, repoFullName, profileId);
        await gitExec(["remote", "set-url", "origin", newUrl], dir);
      } catch {
        // Best effort
      }
    })
  );
}
