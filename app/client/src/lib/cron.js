// Cron expression display helpers

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function describeCron(expression) {
  if (!expression) return "";
  const parts = expression.trim().split(/\s+/);
  if (parts.length < 5) return expression;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Every minute
  if (minute === "*" && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return "Every minute";
  }

  // Every N minutes
  const minMatch = minute.match(/^\*\/(\d+)$/);
  if (minMatch && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `Every ${minMatch[1]} minutes`;
  }

  // Every N hours
  const hourMatch = hour.match(/^\*\/(\d+)$/);
  if (minute === "0" && hourMatch && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `Every ${hourMatch[1]} hours`;
  }

  // Every hour
  if (minute === "0" && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return "Every hour";
  }

  // Format time
  const formatTime = (h, m) => {
    const hr = parseInt(h);
    const mn = parseInt(m);
    const ampm = hr >= 12 ? "PM" : "AM";
    const displayHr = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr;
    return `${displayHr}:${String(mn).padStart(2, "0")} ${ampm}`;
  };

  // Daily at specific time
  if (!minute.includes("*") && !hour.includes("*") && !hour.includes("/") && dayOfMonth === "*" && month === "*") {
    const timeStr = formatTime(hour, minute);

    if (dayOfWeek === "*") {
      return `Daily at ${timeStr}`;
    }
    if (dayOfWeek === "1-5") {
      return `Weekdays at ${timeStr}`;
    }
    if (dayOfWeek === "0,6") {
      return `Weekends at ${timeStr}`;
    }

    // Specific days
    const dayParts = dayOfWeek.split(",");
    const dayNames = dayParts.map((d) => DAYS[parseInt(d)] || d).join(", ");
    return `${dayNames} at ${timeStr}`;
  }

  // Fallback: return the expression
  return expression;
}

export const CRON_PRESETS = [
  { label: "Every 30 min", value: "*/30 * * * *" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Daily 9am", value: "0 9 * * *" },
  { label: "Weekdays 9am", value: "0 9 * * 1-5" },
  { label: "Weekly Mon 9am", value: "0 9 * * 1" },
];

export function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

export function formatRelativeTime(timestamp) {
  if (!timestamp) return "Never";
  const diff = Date.now() - timestamp;
  if (diff < 0) {
    // Future time
    const absDiff = -diff;
    if (absDiff < 60000) return `in ${Math.floor(absDiff / 1000)}s`;
    if (absDiff < 3600000) return `in ${Math.floor(absDiff / 60000)}m`;
    if (absDiff < 86400000) return `in ${Math.floor(absDiff / 3600000)}h`;
    return `in ${Math.floor(absDiff / 86400000)}d`;
  }
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}
