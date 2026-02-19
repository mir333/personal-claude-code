import { useEffect, useRef, useCallback, useState } from "react";

const BOOT_ID_KEY = "claude-ui-last-boot-id";

export function useWebSocket(onMessage, onServerRestart, onReconnect) {
  const wsRef = useRef(null);
  const onMessageRef = useRef(onMessage);
  const onServerRestartRef = useRef(onServerRestart);
  const onReconnectRef = useRef(onReconnect);
  const [connected, setConnected] = useState(false);
  onMessageRef.current = onMessage;
  onServerRestartRef.current = onServerRestart;
  onReconnectRef.current = onReconnect;
  const hasConnectedBefore = useRef(false);

  const reconnectTimerRef = useRef(null);

  const connect = useCallback(() => {
    // Close existing connection if any
    if (wsRef.current) {
      wsRef.current.onclose = null; // prevent auto-reconnect from old socket
      wsRef.current.close();
    }
    clearTimeout(reconnectTimerRef.current);

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      if (hasConnectedBefore.current) {
        onReconnectRef.current?.();
      }
      hasConnectedBefore.current = true;
    };
    ws.onclose = () => {
      setConnected(false);
      reconnectTimerRef.current = setTimeout(connect, 2000);
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
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((data) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { send, connected, reconnect: connect };
}
