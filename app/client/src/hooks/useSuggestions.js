import { useState, useCallback } from "react";

export function useSuggestions() {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchSuggestions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/suggestions");
      const data = await res.json();
      setSuggestions(data);
    } catch {
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const createSuggestion = useCallback(async (config) => {
    const res = await fetch("/api/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to create suggestion");
    setSuggestions((prev) => [...prev, data].sort((a, b) => a.order - b.order));
    return data;
  }, []);

  const updateSuggestion = useCallback(async (id, updates) => {
    const res = await fetch(`/api/suggestions/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to update suggestion");
    setSuggestions((prev) => prev.map((s) => (s.id === id ? data : s)));
    return data;
  }, []);

  const deleteSuggestion = useCallback(async (id) => {
    const res = await fetch(`/api/suggestions/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Failed to delete suggestion");
    }
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const reorderSuggestions = useCallback(async (orderedIds) => {
    const res = await fetch("/api/suggestions/reorder", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to reorder suggestions");
    setSuggestions(data);
    return data;
  }, []);

  return {
    suggestions,
    loading,
    fetchSuggestions,
    createSuggestion,
    updateSuggestion,
    deleteSuggestion,
    reorderSuggestions,
    setSuggestions,
  };
}
