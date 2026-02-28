import fs from "fs";
import path from "path";
import https from "https";
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

export function readProviders(profileId) {
  const gitDir = getGitDir(profileId);
  const providersPath = path.join(gitDir, "providers.json");
  try {
    return JSON.parse(fs.readFileSync(providersPath, "utf-8"));
  } catch {
    return {};
  }
}

export function writeProviders(providers, profileId) {
  const gitDir = getGitDir(profileId);
  fs.mkdirSync(gitDir, { recursive: true });
  fs.writeFileSync(path.join(gitDir, "providers.json"), JSON.stringify(providers, null, 2), { mode: 0o600 });
}

export function getProviderToken(provider, profileId) {
  const providers = readProviders(profileId);
  return providers[provider]?.token || null;
}

export function getProviderConfig(provider, profileId) {
  const providers = readProviders(profileId);
  return providers[provider] || {};
}

export function syncGitCredentials(profileId) {
  const gitDir = getGitDir(profileId);
  const providers = readProviders(profileId);
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
  fs.writeFileSync(path.join(gitDir, "git-credentials"), lines.join("\n") + (lines.length ? "\n" : ""), { mode: 0o600 });
}

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

export function parseRemoteUrl(remoteUrl, profileId) {
  let m;
  m = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (m) return { provider: "github", owner: m[1], repo: m[2] };
  m = remoteUrl.match(/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/.]+)/);
  if (m) return { provider: "azuredevops", org: m[1], project: m[2], repo: m[3] };
  const glConfig = getProviderConfig("gitlab", profileId);
  const glHost = (glConfig.url || "https://gitlab.com").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const glRe = new RegExp(glHost.replace(/\./g, "\\.") + "[:/]([^/]+)/([^/.]+)");
  m = remoteUrl.match(glRe);
  if (m) return { provider: "gitlab", owner: m[1], repo: m[2], host: glHost };
  m = remoteUrl.match(/gitlab\.com[:/]([^/]+)\/([^/.]+)/);
  if (m) return { provider: "gitlab", owner: m[1], repo: m[2], host: "gitlab.com" };
  return null;
}

export async function fetchPrInfo(remote, branch, profileId) {
  if (remote.provider === "github") {
    const token = getProviderToken("github", profileId);
    if (!token) return null;
    const result = await githubApi("GET", `/repos/${remote.owner}/${remote.repo}/pulls?state=open&head=${remote.owner}:${branch}`, token);
    if (result.status === 200 && result.data.length > 0) {
      const pr = result.data[0];
      return { provider: "github", number: pr.number, title: pr.title, url: pr.html_url, owner: remote.owner, repo: remote.repo };
    }
  } else if (remote.provider === "gitlab") {
    const config = getProviderConfig("gitlab", profileId);
    if (!config.token) return null;
    const projectPath = encodeURIComponent(`${remote.owner}/${remote.repo}`);
    const result = await gitlabApi("GET", `/api/v4/projects/${projectPath}/merge_requests?state=opened&source_branch=${encodeURIComponent(branch)}`, config.token, config.url);
    if (result.status === 200 && result.data.length > 0) {
      const mr = result.data[0];
      return { provider: "gitlab", number: mr.iid, title: mr.title, url: mr.web_url, projectPath };
    }
  } else if (remote.provider === "azuredevops") {
    const config = getProviderConfig("azuredevops", profileId);
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

// Helper to build clone URLs for any provider
export function buildCloneUrl(provider, repoFullName, profileId) {
  if (provider === "github") {
    const token = getProviderToken("github", profileId);
    return `https://${token}@github.com/${repoFullName}.git`;
  } else if (provider === "gitlab") {
    const config = getProviderConfig("gitlab", profileId);
    const host = (config.url || "https://gitlab.com").replace(/^https?:\/\//, "");
    return `https://oauth2:${config.token}@${host}/${repoFullName}.git`;
  } else if (provider === "azuredevops") {
    const config = getProviderConfig("azuredevops", profileId);
    const [project, repo] = repoFullName.split("/");
    return `https://azuredevops:${config.token}@dev.azure.com/${config.organization}/${project}/_git/${repo}`;
  }
  throw new Error(`Unknown provider: ${provider}`);
}
