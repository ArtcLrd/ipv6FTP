// ICE configuration — STUN servers that support IPv6
// WebRTC ICE will automatically prefer IPv6 host candidates when both
// peers have global IPv6 addresses. No TURN needed — free STUN only.
export const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.ekiga.net" }, // IPv6-capable
    { urls: "stun:[2001:4860:4864:5::81]:19302" }, // Google IPv6 STUN endpoint
  ],
  // Prefer IPv6 by including it first in ICE gathering
  iceCandidatePoolSize: 10,
};
