// ICE configuration — STUN servers that support both IPv4 and IPv6.
//
// ICE gathers ALL local candidates automatically (IPv4 + IPv6 addresses)
// and tries every combination with the remote peer. The first working pair wins:
//   - Both have IPv6  → connects over IPv6 (preferred, higher priority per RFC 8445)
//   - One has IPv4 only → IPv6 pairs fail fast, IPv4 pair succeeds automatically
//   - No TURN needed for either case when peers have public addresses via STUN
//
export const ICE_CONFIG = {
  iceServers: [
    // Google STUN — supports both IPv4 and IPv6 reflexive candidate discovery
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    // Cloudflare STUN — reliable global anycast, dual-stack
    { urls: "stun:stun.cloudflare.com:3478" },
    // Google's explicit IPv6 STUN endpoint (bracket notation required)
    { urls: "stun:[2001:4860:4864:5::81]:19302" },
  ],
  // Pre-gather candidates before signaling begins — reduces connection time
  iceCandidatePoolSize: 10,
  // "all" = use STUN reflexive + host candidates; never restrict to relay-only
  iceTransportPolicy: "all",
};

/**
 * Detects which IP version the active P2P connection is actually using.
 * Call this after iceConnectionState === "connected".
 *
 * Returns: "IPv6" | "IPv4" | null
 */
export async function detectConnectionIPVersion(peerConnection) {
  if (!peerConnection) return null;
  try {
    const stats = await peerConnection.getStats();
    for (const report of stats.values()) {
      // Find the active candidate pair
      if (report.type === "candidate-pair" && report.state === "succeeded" && report.nominated) {
        // Get the local candidate for this pair
        const localCandidateReport = stats.get(report.localCandidateId);
        if (localCandidateReport?.address) {
          return localCandidateReport.address.includes(":") ? "IPv6" : "IPv4";
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}
