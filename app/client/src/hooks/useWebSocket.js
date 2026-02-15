import { useEffect, useRef, useCallback, useState } from "react";

const BOOT_ID_KEY = "claude-ui-last-boot-id";

export function useWebSocket(onMessage, onServerRestart) {
  const wsRef = useRef(null);
  const onMessageRef = useRef(onMessage);
  const onServerRestartRef = useRef(onServerRestart);
  const [connected, setConnected] = useState(false);
  onMessageRef.current = onMessage;
  onServerRestartRef.current = onServerRestart;

  useEffect(() => {
    let ws;
    let reconnectTimer;

    function connect() {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        reconnectTimer = setTimeout(connect, 2000);
      };
      ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.type === "welcome" && data.bootId) {
          const lastBootId = localStorage.getItem(BOOT_ID_KEY);
          if (lastBootId && lastBootId !== data.bootId) {
            onServerRestartRef.current?.();
          }
          localStorage.setItem(BOOT_ID_KEY, data.bootId);
          return;
        }
        onMessageRef.current(data);
      };
    }

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  const send = useCallback((data) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { send, connected };
}
