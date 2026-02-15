import { useEffect, useRef, useCallback, useState } from "react";

export function useWebSocket(onMessage) {
  const wsRef = useRef(null);
  const onMessageRef = useRef(onMessage);
  const [connected, setConnected] = useState(false);
  onMessageRef.current = onMessage;

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
