import { useState, useEffect, useRef, useCallback } from "react";

/**
 * useVoice — manages WebRTC audio track for P2P voice calling.
 *
 * Works alongside useWebRTC: adds a microphone audio track to the
 * existing RTCPeerConnection and plays the remote peer's audio stream.
 *
 * @param {React.MutableRefObject} pcRef  — ref to the active RTCPeerConnection
 * @param {string|null}            role   — "offerer" | "answerer" | null
 * @param {Function}               sendSignal — signaling send fn
 * @param {boolean}                isConnected — true when ICE is connected/completed
 */
export function useVoice(pcRef, role, sendSignal, isConnected) {
  const [callState, setCallState] = useState("idle"); // idle | requesting | active | error
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
          // Set up remote analyser for volume meter
          try {
            const ctx = new AudioContext();
            const src = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            src.connect(analyser);
            remoteAnalyser.current = analyser;
          } catch (_) {}
        }
        setCallState("active");
      }
    };

    return () => {
      pc.ontrack = prevOnTrack ?? null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ── Start Call ────────────────────────────────────────────────────────────
  const startCall = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || !isConnected) return;

    setCallState("requesting");
    setErrorMessage("");

    // Check for secure context — getUserMedia requires HTTPS (except localhost)
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setErrorMessage(
        "Voice calls require a secure connection (HTTPS). " +
        "Access this app via HTTPS or from localhost."
      );
      setCallState("error");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 48000 },
        video: false,
      });
      localStreamRef.current = stream;

      // Add each audio track to the peer connection
      stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));

      // Renegotiate — offerer creates a new offer, answerer waits
      if (role === "offerer") {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignalRef.current?.({ type: "offer", payload: offer });
      }

      // Set up local analyser for speaking level meter
      try {
        const ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        localAnalyser.current = analyser;
      } catch (_) {}

      setCallState("active");
    } catch (err) {
      console.error("[voice] getUserMedia error:", err.name, err.message);
      let msg = "Microphone access denied. Please allow mic permissions and try again.";
      if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        msg = "No microphone found. Please connect a microphone and try again.";
      } else if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        // On HTTP (non-localhost) mobile browsers this is thrown even if OS granted permission
        const isInsecure = location.protocol !== "https:" && location.hostname !== "localhost";
        msg = isInsecure
          ? "Voice calls require HTTPS. Open the app via a secure HTTPS link on mobile."
          : "Microphone permission was denied. Please tap Allow when prompted, or check browser settings.";
      } else if (err.name === "NotReadableError") {
        msg = "Microphone is in use by another app. Please close it and try again.";
      }
      setErrorMessage(msg);
      setCallState("error");
    }
  }, [pcRef, isConnected, role]);

  // ── End Call ──────────────────────────────────────────────────────────────
  const endCall = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
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
  }, []);

  // ── Mute toggle ───────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return;
    const enabled = isMuted; // we're un-muting
    localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = enabled; });
    setIsMuted(!isMuted);
  }, [isMuted]);

  // ── Cleanup on unmount / disconnect ──────────────────────────────────────
  useEffect(() => {
    if (!isConnected && callState === "active") {
      endCall();
    }
  }, [isConnected, callState, endCall]);

  return { callState, isMuted, errorMessage, localVolume, remoteVolume, startCall, endCall, toggleMute };
}
