import { useState, useCallback, useRef, useEffect } from "react";

const STORAGE_KEY = "notifications-enabled";

// Generate a short notification chime using the Web Audio API.
// This avoids shipping an audio file and works in all modern browsers.
function playNotificationSound(type = "done") {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    if (type === "error") {
      // Two descending tones for errors
      const freqs = [440, 330];
      freqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.18, ctx.currentTime + i * 0.18);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.25);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.18);
        osc.stop(ctx.currentTime + i * 0.18 + 0.25);
      });
      setTimeout(() => ctx.close(), 800);
    } else {
      // Two ascending tones for success
      const freqs = [523.25, 659.25]; // C5, E5
      freqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.3);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.15);
        osc.stop(ctx.currentTime + i * 0.15 + 0.3);
      });
      setTimeout(() => ctx.close(), 800);
    }
  } catch {
    // AudioContext not available — silently skip
  }
}

export function useNotifications() {
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  // Track whether the browser actually granted permission (for UI feedback)
  const [permissionDenied, setPermissionDenied] = useState(() => {
    return typeof Notification !== "undefined" && Notification.permission === "denied";
  });

  // Keep enabled ref in sync so the notify callback always reads the latest value
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const toggle = useCallback(async () => {
    if (!enabled) {
      // Turning ON: request permission first
      if (typeof Notification !== "undefined") {
        try {
          const result = await Notification.requestPermission();
          if (result === "denied") {
            setPermissionDenied(true);
            // Still enable (so the user sees the bell is "on" and the
            // denied warning) — they can fix it in browser settings.
          } else {
            setPermissionDenied(false);
          }
        } catch {
          // Some browsers throw instead of resolving; treat as denied.
          setPermissionDenied(true);
        }
      }
      localStorage.setItem(STORAGE_KEY, "true");
      setEnabled(true);
    } else {
      // Turning OFF
      localStorage.setItem(STORAGE_KEY, "false");
      setEnabled(false);
    }
  }, [enabled]);

  const notify = useCallback(
    (title, options = {}) => {
      if (!enabledRef.current) return;

      const isHidden = typeof document !== "undefined" && document.hidden;

      // Play sound (even if tab is visible — the sound is subtle enough)
      const soundType = title.toLowerCase().includes("error") ? "error" : "done";
      playNotificationSound(soundType);

      // Only show visual notification if tab is hidden / not focused
      if (!isHidden) return;

      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;

      if (navigator.serviceWorker?.controller) {
        navigator.serviceWorker.ready.then((reg) => {
          reg.showNotification(title, { ...options, requireInteraction: false });
        });
      } else {
        new Notification(title, options);
      }
    },
    [] // no deps — reads enabledRef instead of enabled
  );

  return { enabled, permissionDenied, toggle, notify };
}
