import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

export default function NewAgentForm({ onSubmit, onCancel }) {
  const [name, setName] = useState("");
  const [localOnly, setLocalOnly] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const slug = slugify(name);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || !slug) return;
    setError("");
    setSubmitting(true);
    try {
      await onSubmit(name.trim(), localOnly);
    } catch (err) {
      setError(err.message || "Failed to create project");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <Input
        placeholder="Project name"
        value={name}
        onChange={(e) => { setName(e.target.value); setError(""); }}
        autoFocus
      />
      {slug && (
        <p className="text-xs text-muted-foreground px-1">
          Will create /workspace/{slug}
        </p>
      )}
      <label className="flex items-center gap-2 px-1 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={localOnly}
          onChange={(e) => setLocalOnly(e.target.checked)}
          className="rounded"
        />
        <span className="text-muted-foreground">Local only (no GitHub repo)</span>
      </label>
      {error && <p className="text-destructive text-xs px-1">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" className="flex-1" disabled={!name.trim() || !slug || submitting}>
          {submitting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
          {submitting ? "Creating..." : "Create"}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="flex-1" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
