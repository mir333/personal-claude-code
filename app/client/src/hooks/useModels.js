import { useEffect, useState } from "react";
import {
  getModelsState,
  subscribe,
  loadModels,
  startModelRefresh,
} from "@/lib/models";

// Subscribes to the global model cache and re-renders the consumer whenever
// the cached list changes. The very first time any component mounts this
// hook in the lifetime of the app, we kick off a network fetch and start a
// 1-hour refresh interval. Subsequent mounts are cheap — they just attach a
// subscriber callback.
//
// Returns: { models, loading, source, fetchedAt, refresh }
export function useModels() {
  const [snapshot, setSnapshot] = useState(() => ({ ...getModelsState() }));

  useEffect(() => {
    const unsub = subscribe((state) => setSnapshot({ ...state }));
    // Fire-and-forget: kick off initial fetch + arm the 1h refresh.
    loadModels({ force: false }).catch(() => {});
    startModelRefresh();
    return unsub;
  }, []);

  return {
    models: snapshot.models,
    loading: snapshot.loading,
    source: snapshot.source,
    fetchedAt: snapshot.fetchedAt,
    refresh: () => loadModels({ force: true }),
  };
}
