import { useState } from "react";
import { Plus, ChevronUp, ChevronDown, Pencil, Trash2, X, Check } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const ACTION_TYPES = [
  { value: "prompt", label: "Prompt", description: "Send text as a message" },
  { value: "skill", label: "Skill", description: "Execute a slash command" },
  { value: "platform", label: "Platform", description: "Trigger a built-in action" },
];

const CONTEXT_TAGS = [
  { value: "after_completion", label: "After completion" },
  { value: "after_error", label: "After error" },
  { value: "after_context_cleared", label: "After context cleared" },
  { value: "git", label: "Git" },
  { value: "has_pr", label: "Has PR/MR" },
  { value: "has_review_content", label: "Has review content" },
  { value: "has_bash_calls", label: "Has bash calls" },
  { value: "recovery", label: "Recovery" },
  { value: "fresh_start", label: "Fresh start" },
];

const EMPTY_FORM = {
  name: "",
  description: "",
  actionType: "prompt",
  actionValue: "",
  contextTags: ["after_completion"],
};

export default function SuggestionManager({
  open,
  onClose,
  suggestions = [],
  onCreate,
  onUpdate,
  onDelete,
  onReorder,
}) {
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const sorted = [...suggestions].sort((a, b) => a.order - b.order);

  function startEdit(suggestion) {
    setEditingId(suggestion.id);
    setFormData({
      name: suggestion.name,
      description: suggestion.description || "",
      actionType: suggestion.actionType,
      actionValue: suggestion.actionValue,
      contextTags: [...suggestion.contextTags],
    });
    setShowAddForm(false);
    setError(null);
  }

  function startAdd() {
    setEditingId(null);
    setFormData({ ...EMPTY_FORM });
    setShowAddForm(true);
    setError(null);
  }

  function cancelForm() {
    setEditingId(null);
    setShowAddForm(false);
    setError(null);
  }

  async function handleSave() {
    if (!formData.name.trim()) {
      setError("Name is required");
      return;
    }
    if (!formData.actionValue.trim()) {
      setError("Action value is required");
      return;
    }
    if (formData.contextTags.length === 0) {
      setError("At least one context tag is required");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        await onUpdate(editingId, formData);
      } else {
        await onCreate(formData);
      }
      cancelForm();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    try {
      await onDelete(id);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleToggleEnabled(suggestion) {
    try {
      await onUpdate(suggestion.id, { enabled: !suggestion.enabled });
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleMoveUp(index) {
    if (index <= 0) return;
    const ids = sorted.map((s) => s.id);
    [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
    try {
      await onReorder(ids);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleMoveDown(index) {
    if (index >= sorted.length - 1) return;
    const ids = sorted.map((s) => s.id);
    [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
    try {
      await onReorder(ids);
    } catch (err) {
      setError(err.message);
    }
  }

  function toggleContextTag(tag) {
    setFormData((prev) => ({
      ...prev,
      contextTags: prev.contextTags.includes(tag)
        ? prev.contextTags.filter((t) => t !== tag)
        : [...prev.contextTags, tag],
    }));
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <div className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Manage Suggestions</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1 rounded-md transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="mb-3 px-3 py-2 bg-destructive/10 border border-destructive/30 rounded-md text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Add button */}
        {!showAddForm && !editingId && (
          <Button
            variant="outline"
            size="sm"
            className="mb-3 w-full"
            onClick={startAdd}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Suggestion
          </Button>
        )}

        {/* Add form */}
        {showAddForm && (
          <SuggestionForm
            formData={formData}
            setFormData={setFormData}
            onSave={handleSave}
            onCancel={cancelForm}
            saving={saving}
            toggleContextTag={toggleContextTag}
            title="New Suggestion"
          />
        )}

        {/* Suggestion list */}
        <div className="space-y-1 max-h-[50vh] overflow-y-auto">
          {sorted.map((s, index) => (
            <div key={s.id}>
              {editingId === s.id ? (
                <SuggestionForm
                  formData={formData}
                  setFormData={setFormData}
                  onSave={handleSave}
                  onCancel={cancelForm}
                  saving={saving}
                  toggleContextTag={toggleContextTag}
                  title="Edit Suggestion"
                />
              ) : (
                <div
                  className={cn(
                    "flex items-center gap-2 px-2 py-1.5 rounded-md group hover:bg-muted/50 transition-colors",
                    !s.enabled && "opacity-50"
                  )}
                >
                  {/* Enable/disable toggle */}
                  <button
                    onClick={() => handleToggleEnabled(s)}
                    title={s.enabled ? "Disable" : "Enable"}
                    className={cn(
                      "flex-shrink-0 h-4 w-4 rounded border transition-colors",
                      s.enabled
                        ? "bg-primary border-primary"
                        : "border-muted-foreground/40 hover:border-muted-foreground"
                    )}
                  >
                    {s.enabled && (
                      <Check className="h-3 w-3 text-primary-foreground mx-auto" />
                    )}
                  </button>

                  {/* Name + type badge */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm truncate">{s.name}</span>
                      <Badge
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0 flex-shrink-0"
                      >
                        {s.actionType}
                      </Badge>
                      {s.builtIn && (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 flex-shrink-0"
                        >
                          built-in
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button
                      onClick={() => startEdit(s)}
                      title="Edit"
                      className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    {!s.builtIn && (
                      <button
                        onClick={() => handleDelete(s.id)}
                        title="Delete"
                        className="p-1 text-muted-foreground hover:text-destructive rounded transition-colors"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                    <button
                      onClick={() => handleMoveUp(index)}
                      disabled={index === 0}
                      title="Move up"
                      className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors disabled:opacity-30"
                    >
                      <ChevronUp className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => handleMoveDown(index)}
                      disabled={index === sorted.length - 1}
                      title="Move down"
                      className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors disabled:opacity-30"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

function SuggestionForm({
  formData,
  setFormData,
  onSave,
  onCancel,
  saving,
  toggleContextTag,
  title,
}) {
  return (
    <div className="mb-3 p-3 border border-border rounded-lg bg-card space-y-3">
      <h3 className="text-sm font-medium">{title}</h3>

      {/* Name */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Name</label>
        <Input
          value={formData.name}
          onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
          placeholder="e.g. Run linter"
          maxLength={50}
        />
      </div>

      {/* Description */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Description</label>
        <Input
          value={formData.description}
          onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
          placeholder="Tooltip shown on hover"
        />
      </div>

      {/* Action Type */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Action Type</label>
        <div className="flex gap-1">
          {ACTION_TYPES.map((at) => (
            <button
              key={at.value}
              onClick={() => setFormData((prev) => ({ ...prev, actionType: at.value }))}
              title={at.description}
              className={cn(
                "px-2.5 py-1 text-xs rounded-md border transition-colors",
                formData.actionType === at.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted border-border hover:bg-accent"
              )}
            >
              {at.label}
            </button>
          ))}
        </div>
      </div>

      {/* Action Value */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">
          {formData.actionType === "prompt"
            ? "Prompt text"
            : formData.actionType === "skill"
            ? "Slash command (e.g. /commit)"
            : "Platform action key"}
        </label>
        <textarea
          value={formData.actionValue}
          onChange={(e) => setFormData((prev) => ({ ...prev, actionValue: e.target.value }))}
          placeholder={
            formData.actionType === "prompt"
              ? "The message to send..."
              : formData.actionType === "skill"
              ? "/commit"
              : "post-pr-review"
          }
          rows={formData.actionType === "prompt" ? 3 : 1}
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
        />
      </div>

      {/* Context Tags */}
      <div>
        <label className="text-xs text-muted-foreground mb-1.5 block">
          Show when (context tags)
        </label>
        <div className="flex flex-wrap gap-1.5">
          {CONTEXT_TAGS.map((tag) => (
            <button
              key={tag.value}
              onClick={() => toggleContextTag(tag.value)}
              className={cn(
                "px-2 py-0.5 text-xs rounded-full border transition-colors",
                formData.contextTags.includes(tag.value)
                  ? "bg-primary/15 text-primary border-primary/30"
                  : "bg-muted border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {tag.label}
            </button>
          ))}
        </div>
      </div>

      {/* Save/Cancel */}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" onClick={onSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
