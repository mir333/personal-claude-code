import { Resend } from "resend";
import { loadResendConfig } from "./resendConfig.js";

const DEFAULT_FROM = "Claude Tasks <onboarding@resend.dev>";

/**
 * Send task completion notification emails via Resend.
 *
 * @param {string} profileId - The profile that owns the task
 * @param {object} task - The task object (must have .name, .emails)
 * @param {object} runEntry - The run entry ({ id, status, durationMs, error })
 * @param {string} summaryUrl - The public summary URL
 */
export async function sendTaskCompletionEmail(profileId, task, runEntry, summaryUrl) {
  const { token, from } = loadResendConfig(profileId);
  if (!token) {
    console.warn(`[emailer] No Resend token configured for profile ${profileId}, skipping email`);
    return;
  }

  if (!task.emails || task.emails.length === 0) {
    return;
  }

  const resend = new Resend(token);

  const statusEmoji = runEntry.status === "success" ? "\u2705" : runEntry.status === "error" ? "\u274C" : "\u26A0\uFE0F";
  const statusLabel = runEntry.status === "success" ? "Completed"
    : runEntry.status === "error" ? "Failed"
    : "Interrupted";
  const durationSec = Math.round((runEntry.durationMs || 0) / 1000);
  const durationStr = durationSec >= 60
    ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
    : `${durationSec}s`;

  const subject = `${statusEmoji} Task "${task.name}" ${statusLabel}`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="margin-bottom: 16px;">Task Run ${escapeHtml(statusLabel)}</h2>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <tr>
          <td style="padding: 8px 12px; border-bottom: 1px solid #eee; color: #666; width: 120px;">Task</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #eee; font-weight: 500;">${escapeHtml(task.name)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; border-bottom: 1px solid #eee; color: #666;">Status</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${statusEmoji} ${escapeHtml(statusLabel)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; border-bottom: 1px solid #eee; color: #666;">Duration</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${escapeHtml(durationStr)}</td>
        </tr>
        ${runEntry.error ? `
        <tr>
          <td style="padding: 8px 12px; border-bottom: 1px solid #eee; color: #666;">Error</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #eee; color: #c00;">${escapeHtml(runEntry.error)}</td>
        </tr>` : ""}
      </table>
      <a href="${escapeHtml(summaryUrl)}"
         style="display: inline-block; background: #2563eb; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 500;">
        View Summary
      </a>
      <p style="margin-top: 24px; font-size: 12px; color: #999;">
        Run ID: ${escapeHtml(runEntry.id)}
      </p>
    </div>
  `;

  try {
    const { error } = await resend.emails.send({
      from: from || DEFAULT_FROM,
      to: task.emails,
      subject,
      html,
    });

    if (error) {
      console.error(`[emailer] Failed to send email for task "${task.name}":`, error);
    } else {
      console.log(`[emailer] Sent completion email for task "${task.name}" to ${task.emails.join(", ")}`);
    }
  } catch (err) {
    console.error(`[emailer] Error sending email for task "${task.name}":`, err.message);
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
