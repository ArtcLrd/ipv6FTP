import { useMemo } from "react";

/**
 * VoicePanel — UI card for P2P voice calling.
 *
 * Props:
 *   callState   — "idle" | "requesting" | "active" | "error"
 *   isMuted     — boolean
 *   localVolume — 0-1 (microphone level)
 *   remoteVolume— 0-1 (remote peer level)
 *   isConnected — boolean (peer-to-peer link established)
 *   onStart     — fn
 *   onEnd       — fn
 *   onToggleMute— fn
 */
export function VoicePanel({
  callState,
  isMuted,
  errorMessage,
  localVolume,
  remoteVolume,
  isConnected,
  onStart,
  onEnd,
  onToggleMute,
}) {
  const isActive      = callState === "active";
  const isRequesting  = callState === "requesting";
  const isError       = callState === "error";

  // Build 8 volume bar heights for each meter
  const buildBars = (volume) =>
    Array.from({ length: 8 }, (_, i) => {
      const threshold = (i + 1) / 8;
      return volume >= threshold;
    });

  const localBars  = useMemo(() => buildBars(localVolume),  [localVolume]);
  const remoteBars = useMemo(() => buildBars(remoteVolume), [remoteVolume]);

  return (
    <div className="voice-panel">
      <div className="voice-panel__header">
        <span className={`voice-panel__icon ${isActive ? "voice-panel__icon--active" : ""}`}>
          🎙️
        </span>
        <span className="voice-panel__title">Voice Call</span>
        {isActive && (
          <span className="voice-panel__live-badge">LIVE</span>
        )}
      </div>

      {errorMessage && (
        <div className="voice-panel__error">
          {errorMessage}
        </div>
      )}

      {/* Volume meters — only while call is active */}
      {isActive && (
        <div className="voice-meters">
          <div className="voice-meter">
            <span className="voice-meter__label">You</span>
            <div className="voice-meter__bars">
              {localBars.map((lit, i) => (
                <div
                  key={i}
                  className={`voice-meter__bar ${lit ? "voice-meter__bar--lit" : ""} ${isMuted ? "voice-meter__bar--muted" : ""}`}
                />
              ))}
            </div>
          </div>
          <div className="voice-meter">
            <span className="voice-meter__label">Peer</span>
            <div className="voice-meter__bars">
              {remoteBars.map((lit, i) => (
                <div
                  key={i}
                  className={`voice-meter__bar ${lit ? "voice-meter__bar--lit voice-meter__bar--remote" : ""}`}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="voice-panel__controls">
        {/* Start / End Call button */}
        {!isActive ? (
          <button
            id="voice-start-btn"
            className="btn btn--primary voice-btn"
            onClick={onStart}
            disabled={!isConnected || isRequesting}
          >
            {isRequesting ? (
              <><span className="spinner" /> Connecting…</>
            ) : (
              <> 📞 Start Call</>
            )}
          </button>
        ) : (
          <button
            id="voice-end-btn"
            className="btn btn--end-call voice-btn"
            onClick={onEnd}
          >
            📵 End Call
          </button>
        )}

        {/* Mute toggle — only while active */}
        {isActive && (
          <button
            id="voice-mute-btn"
            className={`btn voice-mute-btn ${isMuted ? "voice-mute-btn--muted" : ""}`}
            onClick={onToggleMute}
            title={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? "🔇" : "🎙️"}
          </button>
        )}
      </div>

      {!isConnected && callState === "idle" && (
        <p className="voice-panel__hint">Connect to a peer to start a call</p>
      )}
    </div>
  );
}
