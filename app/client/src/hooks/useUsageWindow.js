import { useState, useEffect, useCallback } from "react";

const EMPTY = { active: false, usedTokens: 0, limit: 88000, planId: "max5", windowStart: null, resetAt: null };

export function useUsageWindow(intervalMs = 60_000) {
  const [window, setWindow] = useState(EMPTY);

  const refresh = useCallback(() => {
    fetch("/api/usage/window")
      .then((r) => (r.ok ? r.json() : EMPTY))
      .then(setWindow)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);

  return { window, refresh };
}
