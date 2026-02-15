import { useState, useEffect, useCallback } from "react";

const EMPTY = {
  session: { totalCost: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, requests: 0 },
  weekly: { totalCost: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, requests: 0 },
};

export function useUsageStats(intervalMs = 60_000) {
  const [usage, setUsage] = useState(EMPTY);

  const fetchUsage = useCallback(() => {
    fetch("/api/usage")
      .then((r) => (r.ok ? r.json() : EMPTY))
      .then(setUsage)
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchUsage();
    const id = setInterval(fetchUsage, intervalMs);
    return () => clearInterval(id);
  }, [fetchUsage, intervalMs]);

  return { usage, refresh: fetchUsage };
}
