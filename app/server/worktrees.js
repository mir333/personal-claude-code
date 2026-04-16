import { execPromise, gitExec } from "./providers.js";
import { existsSync, statSync, rmSync } from "fs";
import path from "path";

/**
 * Sanitize a branch name for use in directory paths.
 * Replaces '/' with '-', strips unsafe characters.
 */
export function sanitizeBranchName(branch) {
  return branch
    .replace(/\//g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Build the worktree directory path for a given branch.
 * E.g. /workspace/slug/my-project + feature/login -> /workspace/slug/my-project--feature-login
 */
export function buildWorktreePath(mainDir, branch) {
  const sanitized = sanitizeBranchName(branch);
  return `${mainDir}--${sanitized}`;
}

/**
 * Parse the output of `git worktree list --porcelain` into structured data.
 * Returns [{ path, branch, isMain, head }]
 */
function parseWorktreeList(output) {
  if (!output || !output.trim()) return [];
  const blocks = output.trim().split("\n\n");
  const worktrees = [];
  let isFirst = true;

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    const entry = { path: null, branch: null, isMain: false, head: null };
    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        entry.path = line.slice("worktree ".length).trim();
      } else if (line.startsWith("HEAD ")) {
        entry.head = line.slice("HEAD ".length).trim();
      } else if (line.startsWith("branch ")) {
        // branch refs/heads/feature-x -> feature-x
        const ref = line.slice("branch ".length).trim();
        entry.branch = ref.replace(/^refs\/heads\//, "");
      } else if (line === "detached") {
        entry.branch = "(detached)";
      }
    }
    if (entry.path) {
      entry.isMain = isFirst;
      worktrees.push(entry);
    }
    isFirst = false;
  }
  return worktrees;
}

/**
 * List all worktrees for a git repository.
 * Can be called from any worktree directory (main or linked).
 * Returns [{ path, branch, isMain, head }]
 */
export async function listWorktrees(repoDir) {
  try {
    const output = await gitExec(["worktree", "list", "--porcelain"], repoDir);
    return parseWorktreeList(output);
  } catch (err) {
    console.error(`[worktrees] listWorktrees failed for ${repoDir}:`, err.message);
    return [];
  }
}

/**
 * Get the main worktree directory from any worktree path.
 * Uses `git rev-parse --git-common-dir` to find the shared .git directory,
 * then derives the main worktree path from it.
 */
export async function getMainWorktreeDir(anyWorktreeDir) {
  try {
    // First check if this is even a git repo
    const topLevel = await gitExec(["rev-parse", "--show-toplevel"], anyWorktreeDir);
    if (!topLevel) return null;

    // Get the common git dir (shared across all worktrees)
    const commonDir = await gitExec(["rev-parse", "--git-common-dir"], anyWorktreeDir);
    if (!commonDir) return topLevel;

    // If commonDir is ".git", we're in the main worktree
    if (commonDir === ".git") return topLevel;

    // commonDir is an absolute path like /workspace/slug/my-project/.git
    // The main worktree is the parent of that .git directory
    const absCommonDir = path.isAbsolute(commonDir)
      ? commonDir
      : path.resolve(anyWorktreeDir, commonDir);

    return path.dirname(absCommonDir);
  } catch (err) {
    console.error(`[worktrees] getMainWorktreeDir failed for ${anyWorktreeDir}:`, err.message);
    return null;
  }
}

/**
 * Check if a directory is a linked (non-main) git worktree.
 * Linked worktrees have a `.git` file (not directory) that points to the main repo.
 */
export function isLinkedWorktree(dirPath) {
  try {
    const gitPath = path.join(dirPath, ".git");
    if (!existsSync(gitPath)) return false;
    const stat = statSync(gitPath);
    return stat.isFile(); // linked worktrees have .git as a file, not directory
  } catch (err) {
    console.error(`[worktrees] isLinkedWorktree failed for ${dirPath}:`, err.message);
    return false;
  }
}

/**
 * Add a new git worktree for a branch.
 * @param {string} mainDir - The main worktree directory
 * @param {string} branch - The branch name to checkout
 * @param {string} targetPath - The filesystem path for the new worktree
 * @param {boolean} createBranch - If true, create a new branch from HEAD
 * @returns {{ ok: boolean, error?: string }}
 */
export async function addWorktree(mainDir, branch, targetPath, createBranch = false) {
  if (existsSync(targetPath)) {
    return { ok: false, error: `Directory already exists: ${path.basename(targetPath)}` };
  }

  try {
    if (createBranch) {
      // Create new branch and worktree
      await execPromise("git", ["worktree", "add", "-b", branch, targetPath], {
        cwd: mainDir,
        timeout: 15000,
      });
    } else {
      // Checkout existing branch into new worktree
      await execPromise("git", ["worktree", "add", targetPath, branch], {
        cwd: mainDir,
        timeout: 15000,
      });
    }
    return { ok: true };
  } catch (err) {
    console.error(`[worktrees] addWorktree initial attempt failed (branch=${branch}, target=${targetPath}):`, err.message);
    // If branch doesn't exist locally, try fetching and retrying
    if (!createBranch && err.message && err.message.includes("is not a commit")) {
      try {
        await execPromise("git", ["fetch", "origin", branch], { cwd: mainDir, timeout: 15000 });
        await execPromise("git", ["worktree", "add", targetPath, branch], {
          cwd: mainDir,
          timeout: 15000,
        });
        return { ok: true };
      } catch (retryErr) {
        console.error(`[worktrees] addWorktree retry after fetch failed (branch=${branch}):`, retryErr.message);
        return { ok: false, error: retryErr.message || "Failed to add worktree" };
      }
    }
    return { ok: false, error: err.message || "Failed to add worktree" };
  }
}

/**
 * Remove a git worktree.
 * @param {string} mainDir - The main worktree directory
 * @param {string} worktreePath - The worktree path to remove
 * @returns {{ ok: boolean, error?: string }}
 */
export async function removeWorktree(mainDir, worktreePath) {
  try {
    await execPromise("git", ["worktree", "remove", "--force", worktreePath], {
      cwd: mainDir,
      timeout: 15000,
    });
    return { ok: true };
  } catch (err) {
    console.error(`[worktrees] removeWorktree via git failed (worktree=${worktreePath}), trying manual cleanup:`, err.message);
    // If git worktree remove fails, try manual cleanup
    try {
      rmSync(worktreePath, { recursive: true, force: true });
      // Prune stale worktree entries
      await execPromise("git", ["worktree", "prune"], { cwd: mainDir, timeout: 10000 });
      return { ok: true };
    } catch (cleanupErr) {
      console.error(`[worktrees] Manual cleanup of ${worktreePath} also failed:`, cleanupErr.message);
      return { ok: false, error: err.message || "Failed to remove worktree" };
    }
  }
}
