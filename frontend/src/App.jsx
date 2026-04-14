import { useState, useCallback, useRef } from "react";
import { useMyIP } from "./hooks/useMyIP";
import { useSignaling } from "./hooks/useSignaling";
import { useWebRTC } from "./hooks/useWebRTC";
import { useFileTransfer } from "./hooks/useFileTransfer";
import { IPDisplay } from "./components/IPDisplay";
import { RoomPanel } from "./components/RoomPanel";
import { FileExplorer } from "./components/FileExplorer";
import { UploadZone } from "./components/UploadZone";
import { TransferProgress } from "./components/TransferProgress";

export default function App() {
  const { ip, isIPv6, loading: ipLoading, error: ipError } = useMyIP();

  // Room and connection state
  const [roomID, setRoomID] = useState(null);
  const [role, setRole] = useState(null); // "offerer" | "answerer"
  const [peerStatus, setPeerStatus] = useState("waiting"); // "waiting" | "joined"
  const [dataChannel, setDataChannel] = useState(null);

  // ── Signaling ──────────────────────────────────────────────────────────
  const handleSignalRef = useRef(null);

  const onSignalingMessage = useCallback((msg) => {
    switch (msg.type) {
      case "peer-joined":
        // We are the offerer — peer has arrived, WebRTC hook will start offer
        setPeerStatus("joined");
        break;
      case "room-ready":
        // We are the answerer — we joined and are waiting for an offer
        setPeerStatus("joined");
        break;
      case "peer-left":
        setPeerStatus("waiting");
        setDataChannel(null);
        break;
      case "offer":
      case "answer":
      case "ice-candidate":
        // Forward WebRTC signaling messages to the WebRTC hook
        handleSignalRef.current?.(msg);
        break;
      default:
        break;
    }
  }, []);

  const { send: sendSignal, wsState, error: signalingError } = useSignaling(
    roomID,
    onSignalingMessage
  );

  // ── WebRTC ─────────────────────────────────────────────────────────────
  // Role is set when peer joins: offerer creates offer immediately.
  // Answerer role is set when the answerer joins (they wait for offer).
  const activeRole =
    peerStatus === "joined" ? role : null;

  const onChannelOpen = useCallback((ch) => {
    setDataChannel(ch);
  }, []);

  const { iceState, connState, handleSignal } = useWebRTC(
    activeRole,
    sendSignal,
    onChannelOpen
  );

  // Keep handleSignal ref updated for the signaling callback
  handleSignalRef.current = handleSignal;

  // ── File Transfer ──────────────────────────────────────────────────────
  const {
    sharedFiles,
    addSharedFile,
    removeSharedFile,
    remoteFiles,
    transfers,
    requestFile,
  } = useFileTransfer(dataChannel);

  // ── Room actions ───────────────────────────────────────────────────────
  const handleCreateRoom = useCallback((id) => {
    setRoomID(id);
    setRole("offerer"); // Creator is always the offerer
  }, []);

  const handleJoinRoom = useCallback((id) => {
    setRoomID(id);
    setRole("answerer"); // Joiner is always the answerer
  }, []);

  const isConnected = iceState === "connected" || iceState === "completed";

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="header">
        <div className="header__logo">
          <span className="header__logo-icon">⚡</span>
          <span className="header__logo-text">ipv6FTP</span>
        </div>
        <div className="header__tagline">
          P2P file transfer over WebRTC · IPv6 preferred
        </div>
      </header>

      <main className="main">
        {/* ── Left Column ── */}
        <div className="column column--left">
          {/* IP info */}
          <section className="card">
            <IPDisplay
              ip={ip}
              isIPv6={isIPv6}
              loading={ipLoading}
              error={ipError}
            />
          </section>

          {/* Room */}
          <section className="card">
            <RoomPanel
              roomID={roomID}
              wsState={wsState}
              iceState={iceState}
              peerStatus={peerStatus}
              signalingError={signalingError}
              onCreateRoom={handleCreateRoom}
              onJoinRoom={handleJoinRoom}
            />
          </section>

          {/* Transfer progress */}
          {transfers.length > 0 && (
            <section className="card">
              <TransferProgress transfers={transfers} />
            </section>
          )}
        </div>

        {/* ── Right Column ── */}
        <div className="column column--right">
          {/* Upload zone */}
          <section className="card">
            <UploadZone
              onFilesAdded={addSharedFile}
              disabled={!isConnected}
            />
          </section>

          {/* File explorer */}
          <section className="card">
            <FileExplorer
              sharedFiles={sharedFiles}
              remoteFiles={remoteFiles}
              onRemove={removeSharedFile}
              onDownload={requestFile}
              isConnected={isConnected}
            />
          </section>
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="footer">
        <span>WebRTC DataChannel · No server sees your files</span>
        <span className="footer__divider">|</span>
        <span>
          ICE: <code>{iceState}</code>
        </span>
        {isIPv6 && (
          <>
            <span className="footer__divider">|</span>
            <span className="footer__ipv6-badge">IPv6 ⚡</span>
          </>
        )}
      </footer>
    </div>
  );
}
