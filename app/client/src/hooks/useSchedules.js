import { useState, useCallback } from "react";

export function useSchedules() {
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchSchedules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/schedules");
      const data = await res.json();
      setSchedules(data);
    } catch {
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const createSchedule = useCallback(async (config) => {
    const res = await fetch("/api/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to create schedule");
    setSchedules((prev) => [data, ...prev]);
    return data;
  }, []);

  const updateSchedule = useCallback(async (id, updates) => {
    const res = await fetch(`/api/schedules/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to update schedule");
    setSchedules((prev) => prev.map((s) => (s.id === id ? data : s)));
    return data;
  }, []);

  const deleteSchedule = useCallback(async (id) => {
    const res = await fetch(`/api/schedules/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Failed to delete schedule");
    }
    setSchedules((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const toggleSchedule = useCallback(async (id, enabled) => {
    const res = await fetch(`/api/schedules/${id}/toggle`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to toggle schedule");
    setSchedules((prev) => prev.map((s) => (s.id === id ? data : s)));
    return data;
  }, []);

  const triggerSchedule = useCallback(async (id) => {
    const res = await fetch(`/api/schedules/${id}/trigger`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to trigger schedule");
    // Mark as running locally
    setSchedules((prev) => prev.map((s) => (s.id === id ? { ...s, running: true } : s)));
    return data;
  }, []);

  const fetchRuns = useCallback(async (scheduleId, limit = 20) => {
    const res = await fetch(`/api/schedules/${scheduleId}/runs?limit=${limit}`);
    if (!res.ok) return [];
    return res.json();
  }, []);

  const fetchRunDetail = useCallback(async (scheduleId, runId) => {
    const res = await fetch(`/api/schedules/${scheduleId}/runs/${runId}`);
    if (!res.ok) return null;
    return res.json();
  }, []);

  const validateCron = useCallback(async (cronExpression) => {
    const res = await fetch("/api/schedules/validate-cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cronExpression }),
    });
    return res.json();
  }, []);

  return {
    schedules,
    loading,
    fetchSchedules,
    createSchedule,
    updateSchedule,
    deleteSchedule,
    toggleSchedule,
    triggerSchedule,
    fetchRuns,
    fetchRunDetail,
    validateCron,
    setSchedules,
  };
}
