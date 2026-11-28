import { useState, useCallback, useRef, useEffect } from "react";
import { useMyIP } from "../hooks/useMyIP";
import { useSignaling } from "../hooks/useSignaling";
import { useWebRTC } from "../hooks/useWebRTC";
import { useFileTransfer } from "../hooks/useFileTransfer";
import { useVoice } from "../hooks/useVoice";
import { useAuth } from "../contexts/AuthContext";
import { useSSE } from "../hooks/useSSE";
import { IPDisplay } from "../components/IPDisplay";
import { RoomPanel } from "../components/RoomPanel";
import { FileExplorer } from "../components/FileExplorer";
import { UploadZone } from "../components/UploadZone";
import { TransferProgress } from "../components/TransferProgress";
import { VoicePanel } from "../components/VoicePanel";
import { ContactsPanel } from "../components/ContactsPanel";
import { InviteModal } from "../components/InviteModal";

// How long to wait (ms) for ICE to connect before auto-cancelling
const ICE_CONNECT_TIMEOUT_MS = 20_000;
// Grace period before treating "disconnected" as truly failed
const ICE_DISCONNECT_GRACE_MS = 5_000;

export function AppPage() {
  const { user, logout, showGuestPrompt } = useAuth();
  const { ip, isIPv6, loading: ipLoading, error: ipError } = useMyIP();
  const [invite, setInvite] = useState(null);

  // ── Room & connection state ─────────────────────────────────────────────
  const [roomID, setRoomID] = useState(null);
  const [role, setRole] = useState(null);            // "offerer" | "answerer" | null
  const [peerStatus, setPeerStatus] = useState("waiting");
  const [dataChannel, setDataChannel] = useState(null);
  const [queuePosition, setQueuePosition] = useState(null);

  // Refs for timeouts & call-accept
  const iceTimeoutRef     = useRef(null);
  const iceGraceTimerRef  = useRef(null);
  const pendingCallAcceptRef = useRef(false); // answerer: trigger acceptCall when ICE connects
  const pendingCallStartRef  = useRef(false); // caller:   trigger startCall  when ICE connects

  const wasActiveRef       = useRef(false);
  const handleSignalRef    = useRef(null);
  const handleCallSignalRef = useRef(null);
  const disconnectRef      = useRef(null);

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
    // DataChannel open = fully connected; clear the connection timeout
    if (iceTimeoutRef.current) {
      clearTimeout(iceTimeoutRef.current);
      iceTimeoutRef.current = null;
    }
  }, []);

  const { iceState, connState, connectionIPVersion, pcRef, handleSignal, cleanup: cleanupWebRTC } = useWebRTC(
    activeRole,
    sendSignal,
    onChannelOpen,
  );

  handleSignalRef.current = handleSignal;
  const isConnected = iceState === "connected" || iceState === "completed";

  const {
    callState, isMuted, errorMessage, localVolume, remoteVolume,
    startCall, acceptCall, rejectCall, endCall, toggleMute, handleCallSignal, directConnect
  } = useVoice(pcRef, activeRole, sendSignal, isConnected);

  handleCallSignalRef.current = handleCallSignal;

  const {
    sharedFiles, addSharedFile, removeSharedFile, remoteFiles, transfers, requestFile,
  } = useFileTransfer(dataChannel);

  // ── Master disconnect ───────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    // Clear all timers
    if (iceTimeoutRef.current)    { clearTimeout(iceTimeoutRef.current);    iceTimeoutRef.current = null; }
    if (iceGraceTimerRef.current) { clearTimeout(iceGraceTimerRef.current); iceGraceTimerRef.current = null; }
    // Clear pending call flags so they don't fire on the next connection
    pendingCallStartRef.current  = false;
    pendingCallAcceptRef.current = false;
    cleanupWebRTC();
    setRoomID(null);
    setRole(null);
    setPeerStatus("waiting");
    setDataChannel(null);
    setQueuePosition(null);
    wasActiveRef.current = false;
  }, [cleanupWebRTC]);

  disconnectRef.current = disconnect;

  // ── BUG 5 FIX: ICE failure → auto-disconnect ────────────────────────────
  // "failed"  → disconnect after 1.5s (certain failure, no recovery)
  // "disconnected" → start 5s grace period; if it recovers, cancel the timer
  useEffect(() => {
    if (iceState === "failed") {
      console.warn("[AppPage] ICE failed — disconnecting.");
      const t = setTimeout(() => disconnect(), 1500);
      return () => clearTimeout(t);
    }

    if (iceState === "disconnected") {
      console.warn("[AppPage] ICE disconnected — starting grace timer.");
      iceGraceTimerRef.current = setTimeout(() => {
        iceGraceTimerRef.current = null;
        console.warn("[AppPage] Grace period expired — disconnecting.");
        disconnectRef.current?.();
      }, ICE_DISCONNECT_GRACE_MS);
      return () => {
        if (iceGraceTimerRef.current) {
          clearTimeout(iceGraceTimerRef.current);
          iceGraceTimerRef.current = null;
        }
      };
    }

    // If ICE recovered (e.g. back to "connected"), cancel the grace timer
    if ((iceState === "connected" || iceState === "completed") && iceGraceTimerRef.current) {
      clearTimeout(iceGraceTimerRef.current);
      iceGraceTimerRef.current = null;
    }
  }, [iceState, disconnect]);

  // ── ICE connection timeout watchdog ─────────────────────────────────────
  useEffect(() => {
    if (!roomID) return;
    if (isConnected) {
      if (iceTimeoutRef.current) { clearTimeout(iceTimeoutRef.current); iceTimeoutRef.current = null; }
      return;
    }

    if (!iceTimeoutRef.current) {
      iceTimeoutRef.current = setTimeout(() => {
        iceTimeoutRef.current = null;
        console.warn(`[AppPage] ICE timeout after ${ICE_CONNECT_TIMEOUT_MS}ms — disconnecting.`);
        disconnectRef.current?.();
      }, ICE_CONNECT_TIMEOUT_MS);
    }

    return () => {
      if (iceTimeoutRef.current) { clearTimeout(iceTimeoutRef.current); iceTimeoutRef.current = null; }
    };
  }, [roomID, isConnected]);

  // ── BUG 2 FIX: Use 50ms delay to let WS teardown complete before new room ─
  const handleJoinRoom = useCallback((id, preferredRole = "answerer") => {
    disconnectRef.current?.();
    setTimeout(() => {
      setRoomID(id);
      setRole(preferredRole);
    }, 50);
  }, []);

  const handleCreateRoom = useCallback((id) => {
    disconnectRef.current?.();
    setTimeout(() => {
      setRoomID(id);
      setRole("offerer");
    }, 50);
  }, []);

  // ── SSE invite events ────────────────────────────────────────────────────
  useSSE((event) => {
    if (event.type === "room-invite" || event.type === "call-invite") {
      setInvite({ ...event.payload, type: event.type === "call-invite" ? "call" : "room" });
    }
  });

  // BUG 1 FIX: pendingCallAcceptRef declared above; handleAcceptInvite used after
  const handleAcceptInvite = () => {
    if (!invite) return;
    handleJoinRoom(invite.room_id, "answerer");
    if (invite.type === "call") {
      // Answerer: trigger acceptCall() once ICE connects
      pendingCallAcceptRef.current = true;
    }
    setInvite(null);
  };

  // Once ICE connects after a call-type invite (answerer side), directly activate
  useEffect(() => {
    if (pendingCallAcceptRef.current && isConnected) {
      pendingCallAcceptRef.current = false;
      directConnect(); // skips WS handshake — both sides activate independently
    }
  }, [isConnected, directConnect]);

  // Once ICE connects after initiating a call (offerer side), directly activate
  useEffect(() => {
    if (pendingCallStartRef.current && isConnected) {
      pendingCallStartRef.current = false;
      directConnect(); // skips WS handshake — both sides activate independently
    }
  }, [isConnected, directConnect]);

  const handleDeclineInvite = () => setInvite(null);

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
              onDisconnect={roomID ? disconnect : null}
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
          {user?.account_type === "guest" ? (
            <section className="card">
              <div className="contacts-panel">
                <h2 className="contacts-panel__title">Contacts</h2>
                <div className="contacts-list__empty">Contacts are available with a registered account.</div>
                <button
                  className="btn btn--primary"
                  onClick={() => showGuestPrompt({
                    code: "guest_restricted_feature",
                    reason: "restricted_feature",
                    trigger_period_key: "feature:contacts",
                  })}
                >
                  See benefits
                </button>
              </div>
            </section>
          ) : user && (
            <section className="card">
              <ContactsPanel 
                onJoinRoom={handleJoinRoom} 
                isConnected={isConnected}
                currentRoomID={roomID}
                onDisconnect={disconnect}
                pendingCallStartRef={pendingCallStartRef}
              />
            </section>
          )}

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
        {roomID && !isConnected && (
          <>
            <span className="footer__divider">|</span>
            <button className="btn btn--danger-ghost btn--sm" onClick={disconnect}>
              Cancel Connection
            </button>
          </>
        )}
      </footer>
    </div>
  );
}
