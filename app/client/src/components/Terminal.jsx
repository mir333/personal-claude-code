import { useEffect, useRef, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

export default function Terminal({ agentId, send, visible, onDataRef }) {
  const containerRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  const currentAgentRef = useRef(null);

  // Write incoming data to xterm
  const writeData = useCallback((data) => {
    if (xtermRef.current) {
      xtermRef.current.write(data);
    }
  }, []);

  // Expose writeData via the ref callback
  useEffect(() => {
    if (onDataRef) {
      onDataRef.current = writeData;
    }
  }, [onDataRef, writeData]);

  // Initialize xterm once
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "monospace",
      theme: {
        background: "#1a1a1a",
        foreground: "#e0e0e0",
        cursor: "#e0e0e0",
        selectionBackground: "#444444",
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Handle user keystrokes
    term.onData((data) => {
      send({ type: "terminal_input", agentId: currentAgentRef.current, data });
    });

    return () => {
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // Handle agent changes — start new terminal session
  useEffect(() => {
    if (!agentId) return;
    currentAgentRef.current = agentId;

    // Clear previous terminal content
    if (xtermRef.current) {
      xtermRef.current.clear();
      xtermRef.current.reset();
    }

    // Start terminal for this agent
    send({ type: "terminal_start", agentId });

    return () => {
      send({ type: "terminal_stop", agentId });
    };
  }, [agentId, send]);

  // Fit on visibility change and resize
  useEffect(() => {
    if (!visible || !fitAddonRef.current) return;

    // Slight delay to ensure container has layout dimensions
    const timer = setTimeout(() => {
      fitAddonRef.current.fit();
      if (xtermRef.current && currentAgentRef.current) {
        const { cols, rows } = xtermRef.current;
        send({ type: "terminal_resize", agentId: currentAgentRef.current, cols, rows });
      }
    }, 50);

    const handleResize = () => {
      fitAddonRef.current.fit();
      if (xtermRef.current && currentAgentRef.current) {
        const { cols, rows } = xtermRef.current;
        send({ type: "terminal_resize", agentId: currentAgentRef.current, cols, rows });
      }
    };

    window.addEventListener("resize", handleResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", handleResize);
    };
  }, [visible, send]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ display: visible ? "block" : "none" }}
    />
  );
}
