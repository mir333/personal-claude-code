import { mkdirSync } from "fs";
import { createRequire } from "module";

const terminals = new Map(); // agentId -> pty

let pty = null;

function loadPty() {
  if (pty) return pty;
  try {
    const require = createRequire(import.meta.url);
    pty = require("node-pty");
    return pty;
  } catch (err) {
    console.error("node-pty not available:", err.message);
    return null;
  }
}

export function spawnTerminal(agentId, workingDirectory) {
  const nodePty = loadPty();
  if (!nodePty) throw new Error("Terminal not available: node-pty failed to load");

  // Kill existing terminal for this agent if any
  killTerminal(agentId);

  // Ensure the working directory exists
  mkdirSync(workingDirectory, { recursive: true });

  const term = nodePty.spawn("claude", [], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: workingDirectory,
    env: process.env,
  });

  terminals.set(agentId, term);
  return term;
}

export function getTerminal(agentId) {
  return terminals.get(agentId) || null;
}

export function killTerminal(agentId) {
  const term = terminals.get(agentId);
  if (term) {
    term.kill();
    terminals.delete(agentId);
  }
}

export function resizeTerminal(agentId, cols, rows) {
  const term = terminals.get(agentId);
  if (term) {
    term.resize(cols, rows);
  }
}

export function killAllTerminals(agentIds) {
  for (const id of agentIds) {
    killTerminal(id);
  }
}
