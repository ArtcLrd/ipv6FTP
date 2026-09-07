import { useState, useEffect } from "react";

/**
 * useMyIP fetches the server-side detected IP and also attempts 
 * client-side WebRTC sniffing to find a global IPv6 address.
 * (Bypasses IPv4-only load balancers like Render's)
 */
export function useMyIP() {
  const [data, setData] = useState({ 
    ip: null, 
    isIPv6: false, 
    loading: true, 
    error: null 
  });

  useEffect(() => {
    let pc = null;
    let isMounted = true;

    async function detect() {
      try {
        // 1. Get server-side detected IP (likely IPv4 on Render)
        const res = await fetch("/api/myip");
        if (!res.ok) throw new Error("Failed to fetch IP from server");
        const serverData = await res.json();

        if (!isMounted) return;

        // 2. Try to find local/global IPv6 via WebRTC candidates
        // This is a common "What's my IP" trick to see the real stack
        pc = new RTCPeerConnection({ 
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }] 
        });
        
        pc.createDataChannel("");
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        let detectedIPv6 = null;

        // Give it up to 2.5 seconds to find a v6 candidate
        const sniffPromise = new Promise((resolve) => {
          pc.onicecandidate = (e) => {
            if (!e.candidate) {
              resolve();
              return;
            }
            
            // Format: "candidate:0 1 UDP 2122252543 <IP> <PORT> typ host ..."
            const parts = e.candidate.candidate.split(" ");
            const addr = parts[4];
            
            // Heuristic for Global IPv6: contains colons and starts with '2' or '3'
            if (addr && addr.includes(":") && (addr.startsWith("2") || addr.startsWith("3"))) {
              detectedIPv6 = addr;
              resolve();
            }
          };
          // Hard cutoff after 2.5s
          setTimeout(resolve, 2500); 
        });

        await sniffPromise;
        pc.close();

        if (!isMounted) return;

        if (detectedIPv6) {
          setData({ 
            ip: detectedIPv6, 
            isIPv6: true, 
            loading: false, 
            error: null 
          });
        } else {
          // Fallback to whatever the server saw (likely the IPv4)
          setData({ 
            ...serverData, 
            loading: false, 
            error: null 
          });
        }
      } catch (err) {
        if (isMounted) {
          setData((prev) => ({ 
            ...prev, 
            loading: false, 
            error: err.message || "Detection failed" 
          }));
        }
      }
    }

    detect();
    
    return () => {
      isMounted = false;
      if (pc) pc.close();
    };
  }, []);

  return data;
}
