import { useState, useEffect, useRef, useCallback } from "react";

const WS_BASE =
  import.meta.env.VITE_WS_URL ||
  (window.location.protocol === "https:" ? "wss://" : "ws://") +
    window.location.host;

/**
 * useSignaling — manages the WebSocket connection to the Go signaling server.
 *
 * @param {string|null} roomID  — the room to join (null = not connected yet)
 * @param {Function}    onMessage — callback invoked with each received Message
 * @returns {{ send, wsState, error }}
 */
export function useSignaling(roomID, onMessage) {
  const wsRef = useRef(null);
  const [wsState, setWsState] = useState("idle"); // idle | connecting | open | closed | error
  const [error, setError] = useState(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage; // keep ref up-to-date without re-running effect

  useEffect(() => {
    if (!roomID) return;

    const url = `${WS_BASE}/ws?room=${encodeURIComponent(roomID)}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    setWsState("connecting");
    setError(null);

    ws.onopen = () => {
      setWsState("open");
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        onMessageRef.current?.(msg);
      } catch (e) {
        console.error("[signaling] invalid JSON:", e);
      }
    };

    ws.onerror = () => {
      setError("WebSocket connection error");
      setWsState("error");
    };

    ws.onclose = (event) => {
      if (event.code === 1009) {
        setError("Room is full — only 2 peers allowed.");
      } else if (event.code !== 1000) {
        setError(`Connection closed (code ${event.code})`);
      }
      setWsState("closed");
    };

    return () => {
      ws.close(1000, "component unmounted");
    };
  }, [roomID]);

  const send = useCallback((msg) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    } else {
      console.warn("[signaling] tried to send but WS not open", msg);
    }
  }, []);

  return { send, wsState, error };
}
