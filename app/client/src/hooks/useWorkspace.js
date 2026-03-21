import { useState, useCallback, useMemo } from "react";

export function useWorkspace() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchDirectories = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/workspace");
      setProjects(await res.json());
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Backward-compatible flat directories list (for App.jsx / Sidebar props that still need it)
  const directories = useMemo(
    () => projects.map((p) => ({ name: p.name, path: p.path })),
    [projects]
  );

  return { projects, directories, loading, fetchDirectories };
}
