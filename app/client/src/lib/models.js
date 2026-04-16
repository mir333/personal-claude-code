export const MODEL_OPTIONS = [
  {
    value: "claude-opus-4-7",
    label: "Opus 4.7",
    description: "Most capable model. Best for complex reasoning and agentic coding. 1M context, 128k output.",
    shortLabel: "opus-4.7",
  },
  {
    value: "claude-sonnet-4-6",
    label: "Sonnet 4.6",
    description: "Best balance of speed and intelligence. 1M context, 64k output, extended thinking.",
    shortLabel: "sonnet-4.6",
  },
  {
    value: "claude-haiku-4-5",
    label: "Haiku 4.5",
    description: "Fastest model with near-frontier intelligence. 200k context, 64k output.",
    shortLabel: "haiku-4.5",
  },
  {
    value: "claude-opus-4-6",
    label: "Opus 4.6",
    description: "Previous-generation Opus. 1M context, 128k output, extended thinking.",
    shortLabel: "opus-4.6",
  },
  {
    value: "claude-opus-4-5",
    label: "Opus 4.5",
    description: "Earlier Opus generation. 200k context, 64k output.",
    shortLabel: "opus-4.5",
  },
  {
    value: "claude-sonnet-4-5",
    label: "Sonnet 4.5",
    description: "Previous Sonnet generation. 200k context, 64k output.",
    shortLabel: "sonnet-4.5",
  },
];

export function getModelLabel(modelValue) {
  if (!modelValue) return "Default";
  const opt = MODEL_OPTIONS.find((m) => m.value === modelValue);
  return opt ? opt.label : modelValue.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

export function getModelShortLabel(modelValue) {
  if (!modelValue) return "Default";
  const opt = MODEL_OPTIONS.find((m) => m.value === modelValue);
  return opt ? opt.shortLabel : modelValue.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}
