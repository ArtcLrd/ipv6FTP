import { useState, useEffect, useRef, useCallback } from "react";
import { ICE_CONFIG } from "../lib/iceConfig";

/**
 * useWebRTC — manages the RTCPeerConnection lifecycle and DataChannel.
 *
 * @param {string|null} role         — "offerer" | "answerer" | null
 * @param {Function}    sendSignal   — function to send a signaling message to the peer
 * @param {Function}    onChannel    — callback when the DataChannel is open: (channel) => void
 *
 * @returns {{ peerConn, dataChannel, iceState, connState, handleSignal }}
 */
export function useWebRTC(role, sendSignal, onChannel) {
  const pcRef = useRef(null);
  const channelRef = useRef(null);
  const [iceState, setIceState] = useState("new");
  const [connState, setConnState] = useState("new");
  const onChannelRef = useRef(onChannel);
  onChannelRef.current = onChannel;

  // Teardown helper
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
    if (!role || !sendSignal) return;

    const pc = new RTCPeerConnection(ICE_CONFIG);
    pcRef.current = pc;

    // --- ICE Candidate handling ---
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        sendSignal({ type: "ice-candidate", payload: candidate.toJSON() });
      }
    };

    pc.oniceconnectionstatechange = () => {
      setIceState(pc.iceConnectionState);
    };

    pc.onconnectionstatechange = () => {
      setConnState(pc.connectionState);
    };

    // --- DataChannel setup ---
    const setupChannel = (channel) => {
      channelRef.current = channel;
      channel.binaryType = "arraybuffer";

      channel.onopen = () => {
        onChannelRef.current?.(channel);
      };

      channel.onclose = () => {
        channelRef.current = null;
      };
    };

    if (role === "offerer") {
      // Offerer creates the DataChannel
      const channel = pc.createDataChannel("fileTransfer", { ordered: true });
      setupChannel(channel);

      // Create and send the SDP offer
      pc.createOffer().then((offer) => {
        pc.setLocalDescription(offer);
        sendSignal({ type: "offer", payload: offer });
      });
    } else if (role === "answerer") {
      // Answerer receives the DataChannel
      pc.ondatachannel = ({ channel }) => {
        setupChannel(channel);
      };
    }

    return cleanup;
  }, [role, sendSignal, cleanup]);

  /**
   * handleSignal — processes incoming signaling messages from the peer.
   * Call this from the useSignaling onMessage callback.
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
          sendSignal({ type: "answer", payload: answer });
          break;
        }
        case "answer": {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
          break;
        }
        case "ice-candidate": {
          if (msg.payload) {
            await pc.addIceCandidate(new RTCIceCandidate(msg.payload));
          }
          break;
        }
        default:
          break;
      }
    } catch (err) {
      console.error("[webrtc] signal handling error:", err);
    }
  }, [sendSignal]);

  return {
    peerConn: pcRef.current,
    dataChannel: channelRef.current,
    iceState,
    connState,
    handleSignal,
    cleanup,
  };
}
