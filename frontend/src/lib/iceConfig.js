// ICE configuration — STUN servers (always present) + TURN servers (fetched from backend).
//
// Why async?
//   TURN credentials are generated server-side per-request (short-lived HMAC tokens
//   or static env-var creds). Fetching them at connection time keeps secrets off the
//   client bundle and lets credentials rotate without a redeploy.
//
// Fallback behaviour:
//   If the backend is unreachable or returns no TURN servers the function falls back
//   to STUN-only mode. IPv6 P2P still works; IPv4 P2P under symmetric NAT will not
//   (expected degradation, not a crash).
//
// ICE candidate priority (RFC 8445):
//   host > server-reflexive (STUN) > relayed (TURN)
//   WebRTC always tries faster direct paths first — TURN is only used as last resort.

const STUN_SERVERS = [
  // Google STUN — supports both IPv4 and IPv6 reflexive candidate discovery
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  // Cloudflare STUN — reliable global anycast, dual-stack
  { urls: "stun:stun.cloudflare.com:3478" },
  // Open Relay Project STUN (same infrastructure as our TURN server)
  { urls: "stun:openrelay.metered.ca:80" },
];

const BASE_CONFIG = {
  iceCandidatePoolSize: 10,
  // "all" = use host + STUN reflexive + TURN relay candidates;
  // WebRTC picks the best available pair automatically.
  iceTransportPolicy: "all",
};

/**
 * getIceConfig — fetches TURN credentials from the backend and returns a
 * fully-assembled RTCConfiguration object.
 *
 * Call this once per PeerConnection, just before `new RTCPeerConnection(...)`.
 *
 * @returns {Promise<RTCConfiguration>}
 */
export async function getIceConfig() {
  try {
    const res = await fetch("/api/turn-credentials");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { servers } = await res.json();

    return {
      ...BASE_CONFIG,
      // STUN servers first (lower latency), TURN servers appended as relay fallback
      iceServers: [
        ...STUN_SERVERS,
        ...servers, // [] when TURN not configured on backend → STUN-only
      ],
    };
  } catch (err) {
    console.warn("[iceConfig] Failed to fetch TURN credentials, using STUN-only:", err);
    return {
      ...BASE_CONFIG,
      iceServers: STUN_SERVERS,
    };
  }
}

/**
 * Detects which IP version the active P2P connection is actually using.
 * Call this after iceConnectionState === "connected".
 *
 * Returns: "IPv6" | "IPv4" | "relay" | null
 * ("relay" means TURN is being used — connection is working through the TURN server)
 */
export async function detectConnectionIPVersion(peerConnection) {
  if (!peerConnection) return null;
  try {
    const stats = await peerConnection.getStats();
    for (const report of stats.values()) {
      // Find the active candidate pair
      if (report.type === "candidate-pair" && report.state === "succeeded" && report.nominated) {
        const localCandidateReport = stats.get(report.localCandidateId);
        if (localCandidateReport) {
          // If the candidate type is relay, the connection is going through TURN
          if (localCandidateReport.candidateType === "relay") {
            return "relay";
          }
          if (localCandidateReport?.address) {
            return localCandidateReport.address.includes(":") ? "IPv6" : "IPv4";
          }
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}
