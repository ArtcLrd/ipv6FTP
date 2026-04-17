import { useState, useCallback, useRef } from "react";
import { useMyIP } from "./hooks/useMyIP";
import { useSignaling } from "./hooks/useSignaling";
import { useWebRTC } from "./hooks/useWebRTC";
import { useFileTransfer } from "./hooks/useFileTransfer";
import { useVoice } from "./hooks/useVoice";
import { IPDisplay } from "./components/IPDisplay";
import { RoomPanel } from "./components/RoomPanel";
import { FileExplorer } from "./components/FileExplorer";
import { UploadZone } from "./components/UploadZone";
import { TransferProgress } from "./components/TransferProgress";
import { VoicePanel } from "./components/VoicePanel";

export default function App() {
  const { ip, isIPv6, loading: ipLoading, error: ipError } = useMyIP();

  // ── Room & connection state ─────────────────────────────────────────────
  const [roomID, setRoomID] = useState(null);
  const [role, setRole] = useState(null);            // "offerer" | "answerer" | null
  const [peerStatus, setPeerStatus] = useState("waiting"); // "waiting" | "joined"
  const [dataChannel, setDataChannel] = useState(null);
  const [queuePosition, setQueuePosition] = useState(null); // null = not queued, N = position

  // Track whether this peer was previously active (to detect rejoins after peer-left)
  const wasActiveRef = useRef(false);

  // ── Signaling ──────────────────────────────────────────────────────────
  const handleSignalRef = useRef(null);

  const onSignalingMessage = useCallback((msg) => {
    // Decode position from payload if present
    const payload = msg.payload
      ? (typeof msg.payload === "string" ? JSON.parse(msg.payload) : msg.payload)
      : null;

    switch (msg.type) {
      // ── Standard pair handshake ──────────────────────────────────────
      case "peer-joined":
        // Either: (a) original room creator waits for joiner,
        //         (b) surviving peer being notified that a queued user was promoted.
        // In case (b) we need to reassign the surviving peer as Offerer so they
        // can initiate a new WebRTC handshake with the promoted Answerer.
        setQueuePosition(null);
        setPeerStatus("joined");
        if (wasActiveRef.current) {
          // Surviving peer: was previously connected, now needs to reconnect.
          // Flip to offerer role so a new offer is created automatically.
          setRole("offerer");
        }
        wasActiveRef.current = false;
        break;

      case "room-ready":
        // Peer is answerer — wait for offer from the offerer.
        setQueuePosition(null);
        setPeerStatus("joined");
        break;

      // ── Queue messages ───────────────────────────────────────────────
      case "queued":
        // We're in queue — room was full when we joined.
        setQueuePosition(payload?.position ?? 1);
        setPeerStatus("waiting");
        break;

      case "queue-position":
        // Our queue position changed (someone ahead of us left).
        setQueuePosition(payload?.position ?? null);
        break;

      case "queue-promoted":
        // We moved from queue to active — we're the Answerer.
        setQueuePosition(null);
        setRole("answerer");
        setPeerStatus("joined");
        break;

      // ── Disconnect ───────────────────────────────────────────────────
      case "peer-left":
        // Our current peer disconnected. If the queue has someone, the server
        // will immediately follow with "peer-joined" (for us) or "queue-promoted"
        // (for the queued client). We mark wasActive so the peer-joined handler
        // knows to flip our role to offerer for the new handshake.
        wasActiveRef.current = true;
        setPeerStatus("waiting");
        setDataChannel(null);
        break;

      // ── WebRTC signaling passthrough ─────────────────────────────────
      case "offer":
      case "answer":
      case "ice-candidate":
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
  // Only activate WebRTC once a peer has joined (or we've been promoted).
  const activeRole = peerStatus === "joined" ? role : null;

  const onChannelOpen = useCallback((ch) => {
    setDataChannel(ch);
    wasActiveRef.current = false; // reset: we're fully connected now
  }, []);

  // onTrack: forward remote audio tracks to the voice hook
  const onTrackRef = useRef(null);
  const handleTrack = useCallback((event) => {
    onTrackRef.current?.(event);
  }, []);

  const { iceState, connState, connectionIPVersion, pcRef, handleSignal } = useWebRTC(
    activeRole,
    sendSignal,
    onChannelOpen,
    handleTrack,
  );

  // Keep handleSignal ref fresh (avoids stale closure in onSignalingMessage)
  handleSignalRef.current = handleSignal;

  const isConnected = iceState === "connected" || iceState === "completed";

  // ── Voice ──────────────────────────────────────────────────────────────
  const { callState, isMuted, errorMessage, localVolume, remoteVolume, startCall, endCall, toggleMute } =
    useVoice(pcRef, activeRole, sendSignal, isConnected);

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
    setRole("offerer"); // Creator waits as offerer until second peer joins
  }, []);

  const handleJoinRoom = useCallback((id) => {
    setRoomID(id);
    setRole("answerer"); // Joiner waits as answerer until offer arrives
  }, []);

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
          <section className="card">
            <IPDisplay
              ip={ip}
              isIPv6={isIPv6}
              loading={ipLoading}
              error={ipError}
            />
          </section>

          <section className="card">
            <RoomPanel
              roomID={roomID}
              wsState={wsState}
              iceState={iceState}
              peerStatus={peerStatus}
              queuePosition={queuePosition}
              signalingError={signalingError}
              onCreateRoom={handleCreateRoom}
              onJoinRoom={handleJoinRoom}
            />
          </section>

          {/* Voice Call Panel */}
          <section className="card">
            <VoicePanel
              callState={callState}
              isMuted={isMuted}
              errorMessage={errorMessage}
              localVolume={localVolume}
              remoteVolume={remoteVolume}
              isConnected={isConnected}
              onStart={startCall}
              onEnd={endCall}
              onToggleMute={toggleMute}
            />
          </section>

          {transfers.length > 0 && (
            <section className="card">
              <TransferProgress transfers={transfers} />
            </section>
          )}
        </div>

        {/* ── Right Column ── */}
        <div className="column column--right">
          <section className="card">
            <UploadZone
              onFilesAdded={addSharedFile}
              disabled={!isConnected}
            />
          </section>

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
        {connectionIPVersion && (
          <>
            <span className="footer__divider">|</span>
            <span className={`footer__transport-badge footer__transport-badge--${connectionIPVersion === "IPv6" ? "v6" : "v4"}`}>
              P2P via {connectionIPVersion} {connectionIPVersion === "IPv6" ? "⚡" : ""}
            </span>
          </>
        )}
        {isIPv6 && !connectionIPVersion && (
          <>
            <span className="footer__divider">|</span>
            <span className="footer__ipv6-badge">IPv6 ⚡</span>
          </>
        )}
      </footer>
    </div>
  );
}
