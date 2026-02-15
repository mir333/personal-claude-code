import { useState, useCallback } from "react";

export function useWorkspace() {
  const [directories, setDirectories] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchDirectories = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/workspace");
      setDirectories(await res.json());
    } catch {
      setDirectories([]);
    } finally {
      setLoading(false);
    }
  }, []);

  return { directories, loading, fetchDirectories };
}
