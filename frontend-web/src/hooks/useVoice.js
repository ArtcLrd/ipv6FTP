import { useState, useEffect, useRef, useCallback } from "react";

/**
 * useVoice — manages WebRTC audio track for P2P voice calling with invite/accept flow.
 *
 * @param {React.MutableRefObject} pcRef  — ref to the active RTCPeerConnection
 * @param {string|null}            role   — "offerer" | "answerer" | null
 * @param {Function}               sendSignal — signaling send fn
 * @param {boolean}                isConnected — true when ICE is connected/completed
 */
export function useVoice(pcRef, role, sendSignal, isConnected) {
  // idle | requesting | calling | incoming | active | error
  const [callState, setCallState] = useState("idle"); 
  const [isMuted, setIsMuted] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [localVolume, setLocalVolume] = useState(0);
  const [remoteVolume, setRemoteVolume] = useState(0);

  const localStreamRef  = useRef(null);
  const remoteAudioRef  = useRef(null); // <audio> element for remote stream
  const localAnalyser   = useRef(null);
  const remoteAnalyser  = useRef(null);
  const animFrameRef    = useRef(null);
  const sendSignalRef   = useRef(sendSignal);
  sendSignalRef.current = sendSignal;

  // ── Remote audio element (invisible, just for playback) ───────────────────
  useEffect(() => {
    const el = document.createElement("audio");
    el.autoplay = true;
    el.playsInline = true;
    el.style.display = "none";
    document.body.appendChild(el);
    remoteAudioRef.current = el;
    return () => {
      el.srcObject = null;
      el.remove();
    };
  }, []);

  // ── Wire pc.ontrack to play incoming audio ────────────────────────────────
  useEffect(() => {
    const pc = pcRef.current;
    if (!pc) return;

    const prevOnTrack = pc.ontrack;
    pc.ontrack = (event) => {
      prevOnTrack?.(event);
      if (event.track.kind === "audio") {
        const stream = event.streams[0] || new MediaStream([event.track]);
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = stream;
          remoteAudioRef.current.play().catch(() => {});
          try {
            const ctx = new AudioContext();
            const src = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            src.connect(analyser);
            remoteAnalyser.current = analyser;
          } catch (_) {}
        }
        // State is already set to active via _activateCall, but it's safe to set here in case.
        setCallState("active");
      }
    };

    return () => {
      pc.ontrack = prevOnTrack ?? null;
    };
  }, [pcRef.current]);

  // ── Volume meter animation loop ───────────────────────────────────────────
  useEffect(() => {
    const buf = new Uint8Array(64);
    const tick = () => {
      if (localAnalyser.current) {
        localAnalyser.current.getByteFrequencyData(buf);
        const avg = buf.reduce((s, v) => s + v, 0) / buf.length;
        setLocalVolume(avg / 255);
      }
      if (remoteAnalyser.current) {
        remoteAnalyser.current.getByteFrequencyData(buf);
        const avg = buf.reduce((s, v) => s + v, 0) / buf.length;
        setRemoteVolume(avg / 255);
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, []);

  // ── Helper: Request Microphone ─────────────────────────────────────────────
  const _requestMicrophone = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setErrorMessage(
        "Voice calls require a secure connection (HTTPS). " +
        "Access this app via HTTPS or from localhost."
      );
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 48000 },
        video: false,
      });
      localStreamRef.current = stream;

      try {
        const ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        localAnalyser.current = analyser;
      } catch (_) {}

      return true;
    } catch (err) {
      console.error("[voice] getUserMedia error:", err.name, err.message);
      let msg = "Microphone access denied. Please allow mic permissions and try again.";
      if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        msg = "No microphone found. Please connect a microphone and try again.";
      } else if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        const isInsecure = location.protocol !== "https:" && location.hostname !== "localhost";
        msg = isInsecure
          ? "Voice calls require HTTPS. Open the app via a secure HTTPS link on mobile."
          : "Microphone permission was denied. Please tap Allow when prompted, or check browser settings.";
      } else if (err.name === "NotReadableError") {
        msg = "Microphone is in use by another app. Please close it and try again.";
      }
      setErrorMessage(msg);
      return false;
    }
  }, []);

  // ── Helper: Activate Call & Renegotiate ────────────────────────────────────
  const _activateCall = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || !localStreamRef.current) return;

    // Add each audio track to the peer connection
    localStreamRef.current.getAudioTracks().forEach((track) => {
      const senders = pc.getSenders();
      if (!senders.find(s => s.track === track)) {
        pc.addTrack(track, localStreamRef.current);
      }
    });

    // Renegotiate — offerer creates a new offer, answerer waits to receive it
    if (role === "offerer") {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignalRef.current?.({ type: "offer", payload: offer });
      } catch (err) {
        console.error("[voice] renegotiation offer error:", err);
      }
    }

    setCallState("active");
  }, [role, pcRef]);

  // ── Actions: Start, Accept, Reject, End ──────────────────────────────────
  const startCall = useCallback(async () => {
    if (!pcRef.current || !isConnected) return;
    setErrorMessage("");
    setCallState("requesting");
    
    const success = await _requestMicrophone();
    if (!success) {
      setCallState("error");
      return;
    }
    
    sendSignalRef.current?.({ type: "call-invite" });
    setCallState("calling");
  }, [pcRef, isConnected, _requestMicrophone]);

  const acceptCall = useCallback(async () => {
    // Only used to answer an incoming in-app call dialog
    setErrorMessage("");
    setCallState("requesting");

    const success = await _requestMicrophone();
    if (!success) {
      setCallState("error");
      sendSignalRef.current?.({ type: "call-rejected" });
      return;
    }

    sendSignalRef.current?.({ type: "call-accepted" });
    await _activateCall();
  }, [_requestMicrophone, _activateCall]);

  /**
   * directConnect — used by SSE-initiated call flows (both caller & callee).
   * Skips the WS call-invite/call-accepted handshake entirely; both sides
   * just request mic and activate. Avoids the race where the late WS call-invite
   * arrives after the peer is already "active" causing a spurious rejection.
   */
  const directConnect = useCallback(async () => {
    if (callState !== "idle") return; // already in a call
    setErrorMessage("");
    setCallState("requesting");
    const success = await _requestMicrophone();
    if (!success) {
      setCallState("error");
      return;
    }
    await _activateCall();
  }, [callState, _requestMicrophone, _activateCall]);

  const endCall = useCallback((shouldSendSignal = true) => {
    if (shouldSendSignal) {
      sendSignalRef.current?.({ type: "call-ended" });
    }
    
    if (localStreamRef.current) {
      const pc = pcRef.current;
      localStreamRef.current.getTracks().forEach((t) => {
        t.stop();
        if (pc) {
          const sender = pc.getSenders().find(s => s.track === t);
          if (sender) pc.removeTrack(sender);
        }
      });
      localStreamRef.current = null;
      
      // Offerer renegotiates to cleanly close remote track natively
      if (pc && role === "offerer" && (callState === "active" || callState === "calling")) {
        pc.createOffer()
          .then(offer => pc.setLocalDescription(offer).then(() => {
            sendSignalRef.current?.({ type: "offer", payload: offer });
          }))
          .catch(() => {});
      }
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    
    localAnalyser.current = null;
    remoteAnalyser.current = null;
    setLocalVolume(0);
    setRemoteVolume(0);
    setCallState("idle");
    setIsMuted(false);
  }, [role, callState, pcRef]);

  const rejectCall = useCallback(() => {
    sendSignalRef.current?.({ type: "call-rejected" });
    endCall(false);
  }, [endCall]);

  // ── Handle incoming Call Signals from App.jsx ─────────────────────────────
  const handleCallSignal = useCallback((msg) => {
    switch (msg.type) {
      case "call-invite":
        if (callState === "idle") {
          setCallState("incoming");
        } else if (callState === "active" || callState === "requesting") {
          // Already active (SSE direct-connect flow) — ignore the WS handshake signal
          // Do NOT reject — that would show a spurious "Peer declined" error.
        } else if (callState === "calling") {
          // Glare: both sides initiated simultaneously — offerer wins, activate directly
          _activateCall();
        } else {
          // "incoming" or "error" — reject
          sendSignalRef.current?.({ type: "call-rejected" });
        }
        break;
      case "call-accepted":
        _activateCall();
        break;
      case "call-rejected":
        // Ignore rejection if we're already in an active call (SSE flow race)
        if (callState !== "active") {
          setErrorMessage("Peer declined the call.");
          endCall(false);
        }
        break;
      case "call-ended":
        endCall(false);
        break;
      default:
        break;
    }
  }, [callState, _activateCall, endCall]);

  // ── Mute toggle ───────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return;
    const enabled = isMuted; // we're un-muting
    localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = enabled; });
    setIsMuted(!isMuted);
  }, [isMuted]);

  // ── Disconnect watcher — grace delay so renegotiation doesn't kill the call ─
  // ICE briefly goes to "checking" during audio track renegotiation, making
  // isConnected false. Without a delay this immediately kills an active call.
  useEffect(() => {
    if (!isConnected && callState !== "idle") {
      const t = setTimeout(() => {
        // Re-read through the closure ref to get the latest value
        if (!isConnected) {
          endCall(false);
          setErrorMessage("Call ended unexpectedly because the peer connection was lost.");
          setCallState("error");
        }
      }, 3000); // 3s grace — renegotiation completes in <1s in normal conditions
      return () => clearTimeout(t);
    }
  }, [isConnected, callState, endCall]);

  return { 
    callState, isMuted, errorMessage, localVolume, remoteVolume, 
    startCall, acceptCall, rejectCall, endCall, toggleMute, handleCallSignal, directConnect
  };
}
