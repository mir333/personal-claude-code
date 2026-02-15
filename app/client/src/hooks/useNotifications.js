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
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return;
      localStorage.setItem(STORAGE_KEY, "true");
      setEnabled(true);
    } else {
      localStorage.setItem(STORAGE_KEY, "false");
      setEnabled(false);
    }
  }, [enabled]);

  const notify = useCallback(
    (title, options) => {
      if (!enabled || Notification.permission !== "granted") return;

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
