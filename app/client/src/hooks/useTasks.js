import { useState, useCallback } from "react";

export function useTasks() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tasks");
      const data = await res.json();
      setTasks(data);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const createTask = useCallback(async (config) => {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to create task");
    setTasks((prev) => [data, ...prev]);
    return data;
  }, []);

  const updateTask = useCallback(async (id, updates) => {
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to update task");
    setTasks((prev) => prev.map((t) => (t.id === id ? data : t)));
    return data;
  }, []);

  const deleteTask = useCallback(async (id) => {
    const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Failed to delete task");
    }
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toggleTask = useCallback(async (id, enabled) => {
    const res = await fetch(`/api/tasks/${id}/toggle`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to toggle task");
    setTasks((prev) => prev.map((t) => (t.id === id ? data : t)));
    return data;
  }, []);

  const triggerTask = useCallback(async (id) => {
    const res = await fetch(`/api/tasks/${id}/trigger`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to trigger task");
    // Mark as running locally
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, running: true } : t)));
    return data;
  }, []);

  const fetchRuns = useCallback(async (taskId, limit = 20) => {
    const res = await fetch(`/api/tasks/${taskId}/runs?limit=${limit}`);
    if (!res.ok) return [];
    return res.json();
  }, []);

  const fetchRunDetail = useCallback(async (taskId, runId) => {
    const res = await fetch(`/api/tasks/${taskId}/runs/${runId}`);
    if (!res.ok) return null;
    return res.json();
  }, []);

  const fetchAllRuns = useCallback(async (limit = 50) => {
    const res = await fetch(`/api/tasks/runs?limit=${limit}`);
    if (!res.ok) return [];
    return res.json();
  }, []);

  const validateCron = useCallback(async (cronExpression) => {
    const res = await fetch("/api/tasks/validate-cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cronExpression }),
    });
    return res.json();
  }, []);

  return {
    tasks,
    loading,
    fetchTasks,
    createTask,
    updateTask,
    deleteTask,
    toggleTask,
    triggerTask,
    fetchRuns,
    fetchRunDetail,
    fetchAllRuns,
    validateCron,
    setTasks,
  };
}
