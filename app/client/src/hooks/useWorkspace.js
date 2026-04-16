import { useState, useCallback, useMemo } from "react";

export function useWorkspace() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  // True once the /api/workspace fetch has completed at least once —
  // regardless of outcome. Consumers use this to distinguish "no projects
  // exist" from "projects haven't been fetched yet", which matters for
  // classifying agents as custom vs. project-bound on page load.
  const [loaded, setLoaded] = useState(false);

  const fetchDirectories = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/workspace");
      setProjects(await res.json());
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, []);

  // Backward-compatible flat directories list (for App.jsx / Sidebar props that still need it)
  const directories = useMemo(
    () => projects.map((p) => ({ name: p.name, path: p.path })),
    [projects]
  );

  return { projects, directories, loading, loaded, fetchDirectories };
}
