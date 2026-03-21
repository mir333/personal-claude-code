import { useState, useCallback } from "react";

export function useAgents() {
  const [agents, setAgents] = useState([]);
  const [gitStatuses, setGitStatuses] = useState({}); // agentId -> { isRepo, branch, state, unpushed }

  const fetchAgents = useCallback(async () => {
    const res = await fetch("/api/agents");
    const list = await res.json();
    setAgents(list);
    // Fetch git status for all agents
    for (const a of list) {
      fetch(`/api/agents/${a.id}/git-status`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => { if (data) setGitStatuses((prev) => ({ ...prev, [a.id]: data })); })
        .catch(() => {});
    }
  }, []);

  const createAgent = useCallback(async (name, localOnlyOrWorkDir, provider) => {
    let body;
    if (typeof localOnlyOrWorkDir === "string" && localOnlyOrWorkDir.startsWith("/workspace/")) {
      // Existing directory click
      body = { name, workingDirectory: localOnlyOrWorkDir };
    } else {
      // New project form
      body = { name, localOnly: !!localOnlyOrWorkDir };
      if (provider) body.provider = provider;
    }
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to create agent");
    }
    setAgents((prev) => [...prev, data]);
    return data;
  }, []);

  const cloneRepo = useCallback(async (repoFullName, provider = "github") => {
    const res = await fetch("/api/agents/clone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoFullName, provider }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to clone repository");
    }
    setAgents((prev) => [...prev, data]);
    return data;
  }, []);

  const removeAgent = useCallback(async (id) => {
    await fetch(`/api/agents/${id}`, { method: "DELETE" });
    setAgents((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const updateAgentStatus = useCallback((id, status) => {
    setAgents((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status } : a))
    );
  }, []);

  const findAgentByWorkDir = useCallback(
    (workingDirectory) => {
      return agents.find((a) => a.workingDirectory === workingDirectory) || null;
    },
    [agents]
  );

  const fetchGitStatus = useCallback(async (agentId) => {
    try {
      const res = await fetch(`/api/agents/${agentId}/git-status`);
      if (res.ok) {
        const data = await res.json();
        setGitStatuses((prev) => ({ ...prev, [agentId]: data }));
      }
    } catch {}
  }, []);

  const fetchAllGitStatuses = useCallback(async () => {
    const current = agents;
    if (current.length === 0) return;
    await Promise.all(current.map((a) => fetchGitStatus(a.id)));
  }, [agents, fetchGitStatus]);

  const addWorktree = useCallback(async (agentId, branch, createBranch = false) => {
    const res = await fetch(`/api/agents/${agentId}/worktree`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branch, createBranch }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to create worktree");
    }
    setAgents((prev) => [...prev, data.agent]);
    return data;
  }, []);

  const removeWorktree = useCallback(async (agentId) => {
    const res = await fetch(`/api/agents/${agentId}/worktree`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Failed to remove worktree");
    }
    setAgents((prev) => prev.filter((a) => a.id !== agentId));
    setGitStatuses((prev) => {
      const next = { ...prev };
      delete next[agentId];
      return next;
    });
  }, []);

  const removeWorktreeByPath = useCallback(async (projectName, worktreePath) => {
    const res = await fetch(`/api/workspace/${encodeURIComponent(projectName)}/worktree`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ worktreePath }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Failed to remove worktree");
    }
    // Remove any agent that was in that worktree path
    setAgents((prev) => prev.filter((a) => a.workingDirectory !== worktreePath));
    setGitStatuses((prev) => {
      const next = { ...prev };
      // Clean up git status entries for agents at this path
      for (const [key, val] of Object.entries(prev)) {
        const agent = agents.find((a) => a.id === key);
        if (agent && agent.workingDirectory === worktreePath) {
          delete next[key];
        }
      }
      return next;
    });
  }, [agents]);

  const deleteAllLocalBranches = useCallback(async (agentId) => {
    const res = await fetch(`/api/agents/${agentId}/branches/local`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to delete local branches");
    }
    return data;
  }, []);

  return {
    agents,
    gitStatuses,
    fetchAgents,
    createAgent,
    cloneRepo,
    removeAgent,
    updateAgentStatus,
    findAgentByWorkDir,
    fetchGitStatus,
    fetchAllGitStatuses,
    addWorktree,
    removeWorktree,
    removeWorktreeByPath,
    deleteAllLocalBranches,
  };
}
