import { useState, useCallback } from "react";

export function useAgents() {
  const [agents, setAgents] = useState([]);

  const fetchAgents = useCallback(async () => {
    const res = await fetch("/api/agents");
    setAgents(await res.json());
  }, []);

  const createAgent = useCallback(async (name, workingDirectory) => {
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, workingDirectory }),
    });
    const agent = await res.json();
    setAgents((prev) => [...prev, agent]);
    return agent;
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

  return { agents, fetchAgents, createAgent, removeAgent, updateAgentStatus };
}
