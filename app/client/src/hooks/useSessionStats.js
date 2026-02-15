import { useState, useCallback } from "react";

const INITIAL_STATS = {
  totalCost: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  requests: 0,
};

export function useSessionStats() {
  const [stats, setStats] = useState(INITIAL_STATS);

  const recordUsage = useCallback((doneMsg) => {
    setStats((prev) => {
      const usage = doneMsg.usage || {};
      return {
        totalCost: prev.totalCost + (doneMsg.cost || 0),
        inputTokens: prev.inputTokens + (usage.input_tokens || 0),
        outputTokens: prev.outputTokens + (usage.output_tokens || 0),
        cacheReadTokens: prev.cacheReadTokens + (usage.cache_read_input_tokens || 0),
        cacheCreationTokens: prev.cacheCreationTokens + (usage.cache_creation_input_tokens || 0),
        requests: prev.requests + 1,
      };
    });
  }, []);

  const resetStats = useCallback(() => setStats(INITIAL_STATS), []);

  return { stats, recordUsage, resetStats };
}
