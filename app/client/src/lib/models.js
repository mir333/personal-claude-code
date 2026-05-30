export const MODEL_OPTIONS = [
  {
    value: "claude-opus-4-8",
    label: "Opus 4.8",
    description: "Most capable model. Complex reasoning and agentic coding. 1M context, 128k output, adaptive thinking.",
    shortLabel: "opus-4.8",
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
    description: "Fastest and most cost-effective. 200k context, 64k output, extended thinking.",
    shortLabel: "haiku-4.5",
  },
  {
    value: "claude-opus-4-7",
    label: "Opus 4.7",
    description: "Previous-gen Opus. Long-horizon agentic work. 1M context, 128k output, adaptive thinking.",
    shortLabel: "opus-4.7",
  },
  {
    value: "claude-opus-4-6",
    label: "Opus 4.6",
    description: "Legacy Opus. 1M context, 128k output, extended thinking.",
    shortLabel: "opus-4.6",
  },
  {
    value: "claude-sonnet-4-5",
    label: "Sonnet 4.5",
    description: "Legacy Sonnet. 200k context, 64k output, extended thinking.",
    shortLabel: "sonnet-4.5",
  },
  {
    value: "claude-opus-4-5",
    label: "Opus 4.5",
    description: "Legacy Opus. 200k context, 64k output, extended thinking.",
    shortLabel: "opus-4.5",
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
