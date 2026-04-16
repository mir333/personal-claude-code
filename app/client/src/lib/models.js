export const MODEL_OPTIONS = [
  {
    value: "claude-sonnet-4-5-20250929",
    label: "Sonnet 4.5",
    description: "Fast and capable. Great balance of speed and quality.",
    shortLabel: "sonnet-4.5",
  },
  {
    value: "claude-sonnet-4-20250514",
    label: "Sonnet 4",
    description: "Previous generation Sonnet. Reliable and efficient.",
    shortLabel: "sonnet-4",
  },
  {
    value: "claude-opus-4-20250514",
    label: "Opus 4",
    description: "Most capable model. Best for complex reasoning tasks.",
    shortLabel: "opus-4",
  },
  {
    value: "claude-haiku-3-5-20241022",
    label: "Haiku 3.5",
    description: "Fastest and most cost-effective. Good for simple tasks.",
    shortLabel: "haiku-3.5",
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
