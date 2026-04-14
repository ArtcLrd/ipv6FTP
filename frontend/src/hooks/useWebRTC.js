import { useState, useEffect, useRef, useCallback } from "react";
import { ICE_CONFIG } from "../lib/iceConfig";

/**
 * useWebRTC — manages the RTCPeerConnection lifecycle and DataChannel.
 *
 * Supports automatic reconnection: whenever `role` changes (e.g. a surviving
 * peer is reassigned from "answerer" to "offerer" after their peer leaves and
 * a queued client is promoted), the old RTCPeerConnection is torn down and a
 * fresh one is created in its place.
 *
 * @param {string|null} role         — "offerer" | "answerer" | null
 * @param {Function}    sendSignal   — function to send a signaling message
 * @param {Function}    onChannel    — callback when DataChannel opens: (channel) => void
 *
 * @returns {{ iceState, connState, handleSignal, cleanup }}
 */
export function useWebRTC(role, sendSignal, onChannel) {
  const pcRef = useRef(null);
  const channelRef = useRef(null);
  const [iceState, setIceState] = useState("new");
  const [connState, setConnState] = useState("new");

  // Keep latest callback refs to avoid stale closures in event handlers
  const onChannelRef = useRef(onChannel);
  onChannelRef.current = onChannel;
  const sendSignalRef = useRef(sendSignal);
  sendSignalRef.current = sendSignal;

  // Teardown helper — closes current PC and channel
  const cleanup = useCallback(() => {
    if (channelRef.current) {
      channelRef.current.close();
      channelRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    setIceState("new");
    setConnState("new");
  }, []);

  useEffect(() => {
    // No role → nothing to set up
    if (!role || !sendSignal) return;

    // Create a fresh RTCPeerConnection for this role
    const pc = new RTCPeerConnection(ICE_CONFIG);
    pcRef.current = pc;

    // ── ICE Candidate handling ──────────────────────────────────────────
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        sendSignalRef.current?.({ type: "ice-candidate", payload: candidate.toJSON() });
      }
    };

    pc.oniceconnectionstatechange = () => setIceState(pc.iceConnectionState);
    pc.onconnectionstatechange    = () => setConnState(pc.connectionState);

    // ── DataChannel setup ───────────────────────────────────────────────
    const setupChannel = (channel) => {
      channelRef.current = channel;
      channel.binaryType = "arraybuffer";

      channel.onopen  = () => onChannelRef.current?.(channel);
      channel.onclose = () => { channelRef.current = null; };
    };

    if (role === "offerer") {
      // Offerer: create DataChannel, then send SDP offer
      const channel = pc.createDataChannel("fileTransfer", { ordered: true });
      setupChannel(channel);

      pc.createOffer().then((offer) => {
        pc.setLocalDescription(offer);
        sendSignalRef.current?.({ type: "offer", payload: offer });
      });
    } else {
      // Answerer: wait for DataChannel from the offerer
      pc.ondatachannel = ({ channel }) => setupChannel(channel);
    }

    // Re-run if role changes (e.g. surviving peer promoted to offerer)
    return cleanup;
  }, [role, sendSignal, cleanup]);

  /**
   * handleSignal — processes incoming SDP/ICE signaling messages.
   * Intended to be called from the useSignaling onMessage callback.
   */
  const handleSignal = useCallback(async (msg) => {
    const pc = pcRef.current;
    if (!pc) return;

    try {
      switch (msg.type) {
        case "offer": {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignalRef.current?.({ type: "answer", payload: answer });
          break;
        }
        case "answer":
          await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
          break;

        case "ice-candidate":
          if (msg.payload) {
            await pc.addIceCandidate(new RTCIceCandidate(msg.payload));
          }
          break;

        default:
          break;
      }
    } catch (err) {
      console.error("[webrtc] signal handling error:", err);
    }
  }, []);

  return { iceState, connState, handleSignal, cleanup };
}
