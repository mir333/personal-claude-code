import { useState, useCallback } from "react";

const STORAGE_KEY = "notifications-enabled";

export function useNotifications() {
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const toggle = useCallback(async () => {
    if (!enabled) {
      // Request permission but toggle on regardless — notify() will
      // gracefully skip if the browser ultimately denies.
      if (typeof Notification !== "undefined") {
        try {
          await Notification.requestPermission();
        } catch {
          // Some browsers throw instead of resolving; ignore.
        }
      }
      localStorage.setItem(STORAGE_KEY, "true");
      setEnabled(true);
    } else {
      localStorage.setItem(STORAGE_KEY, "false");
      setEnabled(false);
    }
  }, [enabled]);

  const notify = useCallback(
    (title, options) => {
      if (!enabled) return;
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;

      if (navigator.serviceWorker?.controller) {
        navigator.serviceWorker.ready.then((reg) => {
          reg.showNotification(title, options);
        });
      } else {
        new Notification(title, options);
      }
    },
    [enabled]
  );

  return { enabled, toggle, notify };
}
