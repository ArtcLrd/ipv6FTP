import { useState, useCallback, useEffect } from "react";

function generateRoomID() {
  // Generate a readable random room ID like "sapphire-7f3a2b"
  const words = [
    "alpha", "beta", "gamma", "delta", "echo", "foxtrot", "sierra",
    "tango", "victor", "xray", "zebra", "cobalt", "amber", "jade",
  ];
  const word = words[Math.floor(Math.random() * words.length)];
  const hex = Math.random().toString(16).slice(2, 8);
  return `${word}-${hex}`;
}

const STATE_LABELS = {
  idle: { label: "Not Connected", color: "grey" },
  connecting: { label: "Connecting…", color: "amber" },
  open: { label: "Signaling Active", color: "amber" },
  "peer-joined": { label: "Peer Joined — Establishing P2P…", color: "amber" },
  connected: { label: "P2P Connected ✓", color: "green" },
  completed: { label: "P2P Connected ✓", color: "green" },
  disconnected: { label: "Disconnected", color: "red" },
  failed: { label: "Connection Failed", color: "red" },
  closed: { label: "Closed", color: "grey" },
  error: { label: "Error", color: "red" },
};

export function RoomPanel({
  roomID,
  wsState,
  iceState,
  peerStatus,
  queuePosition,
  signalingError,
  onCreateRoom,
  onJoinRoom,
  onDisconnect,
}) {
  const [inputRoom, setInputRoom] = useState("");
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState(null); // "create" | "join"

  // BUG 6 FIX: reset mode when room is cleared so label is correct next time
  useEffect(() => {
    if (!roomID) setMode(null);
  }, [roomID]);

  const handleCreate = useCallback(() => {
    const id = generateRoomID();
    setMode("create");
    onCreateRoom(id);
  }, [onCreateRoom]);

  const handleJoin = useCallback(() => {
    const id = inputRoom.trim();
    if (!id) return;
    setMode("join");
    onJoinRoom(id);
  }, [inputRoom, onJoinRoom]);

  const copyRoom = async () => {
    if (!roomID) return;
    await navigator.clipboard.writeText(roomID);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const displayState = iceState === "connected" || iceState === "completed"
    ? STATE_LABELS[iceState]
    : STATE_LABELS[wsState] || STATE_LABELS.idle;

  const isConnected = iceState === "connected" || iceState === "completed";

  return (
    <div className="room-panel">
      <h2 className="room-panel__title">P2P Connection</h2>

      {/* Status indicator */}
      <div className={`room-panel__status status--${displayState.color}`}>
        <span className="status-dot" />
        {displayState.label}
      </div>

      {signalingError && (
        <div className="room-panel__error">{signalingError}</div>
      )}

      {!roomID && (
        <div className="room-panel__actions">
          <button className="btn btn--primary" onClick={handleCreate}>
            ＋ Create Room
          </button>
          <div className="room-panel__divider">or</div>
          <div className="room-panel__join-row">
            <input
              className="input"
              type="text"
              placeholder="Enter Room ID (e.g. sapphire-7f3a2b)"
              value={inputRoom}
              onChange={(e) => setInputRoom(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
            />
            <button
              className="btn btn--secondary"
              onClick={handleJoin}
              disabled={!inputRoom.trim()}
            >
              Join
            </button>
          </div>
        </div>
      )}

      {/* ── Queue status ── */}
      {queuePosition !== null && (
        <div className="room-panel__queue">
          <span className="spinner" />
          <div>
            <div className="room-panel__queue-title">You are <strong>#{queuePosition}</strong> in the queue</div>
            <div className="room-panel__queue-sub">You'll auto-connect when a slot opens.</div>
          </div>
        </div>
      )}

      {roomID && !queuePosition && (

        <div className="room-panel__room-info">
          <div className="room-panel__room-label">
            {mode === "create" ? "Share this Room ID with your peer:" : "Joined Room:"}
          </div>
          <div className="room-panel__room-id-row">
            <code className="room-panel__room-id">{roomID}</code>
            <button className="btn btn--ghost" onClick={copyRoom}>
              {copied ? "✓ Copied!" : "Copy"}
            </button>
          </div>
          {!isConnected && peerStatus !== "joined" && (
            <p className="room-panel__waiting">
              <span className="spinner" /> Waiting for peer to join…
            </p>
          )}
          {!isConnected && onDisconnect && (
            <button
              className="btn btn--secondary btn--sm"
              style={{ marginTop: "12px", width: "100%" }}
              onClick={onDisconnect}
            >
              ✕ Cancel Connection
            </button>
          )}
        </div>
      )}

      {isConnected && (
        <div className="room-panel__connected-info">
          <div className="room-panel__ice-detail">
            ICE state: <code>{iceState}</code>
          </div>
          {onDisconnect && (
            <button
              className="btn btn--danger-ghost btn--sm"
              style={{ marginTop: "10px", width: "100%" }}
              onClick={onDisconnect}
            >
              Disconnect
            </button>
          )}
        </div>
      )}
    </div>
  );
}
