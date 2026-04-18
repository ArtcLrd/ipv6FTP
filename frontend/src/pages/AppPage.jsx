import { useState, useCallback, useRef, useEffect } from "react";
import { useMyIP } from "../hooks/useMyIP";
import { useSignaling } from "../hooks/useSignaling";
import { useWebRTC } from "../hooks/useWebRTC";
import { useFileTransfer } from "../hooks/useFileTransfer";
import { useVoice } from "../hooks/useVoice";
import { useAuth } from "../contexts/AuthContext";
import { useContacts } from "../hooks/useContacts";
import { useSSE } from "../hooks/useSSE";
import { IPDisplay } from "../components/IPDisplay";
import { RoomPanel } from "../components/RoomPanel";
import { FileExplorer } from "../components/FileExplorer";
import { UploadZone } from "../components/UploadZone";
import { TransferProgress } from "../components/TransferProgress";
import { VoicePanel } from "../components/VoicePanel";
import { ContactsPanel } from "../components/ContactsPanel";
import { InviteModal } from "../components/InviteModal";
import { apiPost } from "../lib/api";

export function AppPage() {
  const { user, logout } = useAuth();
  const { ip, isIPv6, loading: ipLoading, error: ipError } = useMyIP();
  const [invite, setInvite] = useState(null);

  // ── Room & connection state ─────────────────────────────────────────────
  const [roomID, setRoomID] = useState(null);
  const [role, setRole] = useState(null);            // "offerer" | "answerer" | null
  const [peerStatus, setPeerStatus] = useState("waiting"); // "waiting" | "joined"
  const [dataChannel, setDataChannel] = useState(null);
  const [queuePosition, setQueuePosition] = useState(null);

  const wasActiveRef = useRef(false);
  const handleSignalRef = useRef(null);
  const handleCallSignalRef = useRef(null);

  const onSignalingMessage = useCallback((msg) => {
    const payload = msg.payload
      ? (typeof msg.payload === "string" ? JSON.parse(msg.payload) : msg.payload)
      : null;

    switch (msg.type) {
      case "peer-joined":
        setQueuePosition(null);
        setPeerStatus("joined");
        if (wasActiveRef.current) setRole("offerer");
        wasActiveRef.current = false;
        break;
      case "room-ready":
        setQueuePosition(null);
        setPeerStatus("joined");
        break;
      case "queued":
        setQueuePosition(payload?.position ?? 1);
        setPeerStatus("waiting");
        break;
      case "queue-position":
        setQueuePosition(payload?.position ?? null);
        break;
      case "queue-promoted":
        setQueuePosition(null);
        setRole("answerer");
        setPeerStatus("joined");
        break;
      case "peer-left":
        wasActiveRef.current = true;
        setPeerStatus("waiting");
        setDataChannel(null);
        break;
      case "offer":
      case "answer":
      case "ice-candidate":
        handleSignalRef.current?.(msg);
        break;
      case "call-invite":
      case "call-accepted":
      case "call-rejected":
      case "call-ended":
        handleCallSignalRef.current?.(msg);
        break;
      default:
        break;
    }
  }, []);

  const { send: sendSignal, wsState, error: signalingError } = useSignaling(
    roomID,
    onSignalingMessage
  );

  const activeRole = peerStatus === "joined" ? role : null;

  const onChannelOpen = useCallback((ch) => {
    setDataChannel(ch);
    wasActiveRef.current = false;
  }, []);

  const { iceState, connState, connectionIPVersion, pcRef, handleSignal } = useWebRTC(
    activeRole,
    sendSignal,
    onChannelOpen,
  );

  handleSignalRef.current = handleSignal;
  const isConnected = iceState === "connected" || iceState === "completed";

  const { 
    callState, isMuted, errorMessage, localVolume, remoteVolume, 
    startCall, acceptCall, rejectCall, endCall, toggleMute, handleCallSignal 
  } = useVoice(pcRef, activeRole, sendSignal, isConnected);

  handleCallSignalRef.current = handleCallSignal;

  const {
    sharedFiles, addSharedFile, removeSharedFile, remoteFiles, transfers, requestFile,
  } = useFileTransfer(dataChannel);

  const handleJoinRoom = useCallback((id, preferredRole = "answerer") => {
    setRoomID(id);
    setRole(preferredRole);
  }, []);

  const handleCreateRoom = useCallback((id) => {
    setRoomID(id);
    setRole("offerer");
  }, []);

  // ── Real-time Events (SSE) ─────────────────────────────────────────────
  useSSE((event) => {
    if (event.type === "room-invite" || event.type === "call-invite") {
      setInvite({ ...event.payload, type: event.type === "call-invite" ? "call" : "room" });
    }
  });

  const handleAcceptInvite = () => {
    if (!invite) return;
    handleJoinRoom(invite.room_id, "answerer");
    if (invite.type === "call") {
      // Small delay to let signaling connect before voice starts
      setTimeout(() => acceptCall(), 500);
    }
    setInvite(null);
  };

  const handleDeclineInvite = () => {
    setInvite(null);
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header__logo">
          <span className="header__logo-icon">⚡</span>
          <span className="header__logo-text">ipv6FTP</span>
        </div>
        {user && (
          <div className="header__user">
            <span className="header__username">@{user.username}</span>
            <button className="btn btn--danger-ghost" onClick={logout}>Sign Out</button>
          </div>
        )}
      </header>

      <main className="main">
        {/* ── Left Column ── */}
        <div className="column column--left">
          <section className="card">
            <IPDisplay ip={ip} isIPv6={isIPv6} loading={ipLoading} error={ipError} />
          </section>

          {user && (
            <section className="card">
              <ContactsPanel 
                onJoinRoom={handleJoinRoom} 
                startCall={startCall}
              />
            </section>
          )}

          <section className="card">
            <RoomPanel
              roomID={roomID}
              wsState={wsState}
              iceState={iceState}
              peerStatus={peerStatus}
              queuePosition={queuePosition}
              signalingError={signalingError}
              onCreateRoom={handleCreateRoom}
              onJoinRoom={(id) => handleJoinRoom(id, "answerer")}
            />
          </section>

          <section className="card">
            <VoicePanel
              callState={callState}
              isMuted={isMuted}
              errorMessage={errorMessage}
              localVolume={localVolume}
              remoteVolume={remoteVolume}
              isConnected={isConnected}
              onStart={startCall}
              onAccept={acceptCall}
              onReject={rejectCall}
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
            <UploadZone onFilesAdded={addSharedFile} disabled={!isConnected} />
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

      {invite && (
        <InviteModal 
          invite={invite} 
          onAccept={handleAcceptInvite} 
          onDecline={handleDeclineInvite} 
        />
      )}

      <footer className="footer">
        <span>WebRTC DataChannel · No server sees your files</span>
        <span className="footer__divider">|</span>
        <span>ICE: <code>{iceState}</code></span>
        {connectionIPVersion && (
          <>
            <span className="footer__divider">|</span>
            <span className={`footer__transport-badge footer__transport-badge--${connectionIPVersion === "IPv6" ? "v6" : "v4"}`}>
              P2P via {connectionIPVersion} {connectionIPVersion === "IPv6" ? "⚡" : ""}
            </span>
          </>
        )}
      </footer>
    </div>
  );
}
