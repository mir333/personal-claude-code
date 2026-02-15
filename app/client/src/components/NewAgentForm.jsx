import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function isValidWorkDir(dir) {
  const normalized = dir.replace(/\/+$/, "");
  return normalized.startsWith("/workspace/") && normalized.length > "/workspace/".length;
}

export default function NewAgentForm({ onSubmit, onCancel }) {
  const [name, setName] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState("/workspace/");
  const [dirTouched, setDirTouched] = useState(false);
  const [error, setError] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    const dir = workingDirectory.trim().replace(/\/+$/, "");
    if (!name.trim()) return;
    if (!isValidWorkDir(dir)) {
      setError("Must be a subfolder of /workspace (e.g. /workspace/my-project)");
      return;
    }
    setError("");
    onSubmit(name.trim(), dir);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <Input
        placeholder="Project name"
        value={name}
        onChange={(e) => {
          const val = e.target.value;
          setName(val);
          if (!dirTouched) {
            const slug = val.toLowerCase().replace(/\s+/g, "-");
            setWorkingDirectory("/workspace/" + slug);
          }
        }}
        autoFocus
      />
      <Input
        placeholder="Working directory"
        value={workingDirectory}
        onChange={(e) => {
          setDirTouched(true);
          setWorkingDirectory(e.target.value);
        }}
      />
      {error && <p className="text-destructive text-xs">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" className="flex-1" disabled={!name.trim()}>
          Create
        </Button>
        <Button type="button" variant="ghost" size="sm" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
