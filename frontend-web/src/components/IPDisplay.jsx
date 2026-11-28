import { useState } from "react";

export function IPDisplay({ ip, isIPv6, loading, error }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!ip) return;
    await navigator.clipboard.writeText(ip);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="ip-display">
      <div className="ip-display__label">Your IP Address</div>
      <div className="ip-display__row">
        {loading ? (
          <span className="ip-display__value ip-display__value--loading">
            Detecting…
          </span>
        ) : error ? (
          <span className="ip-display__value ip-display__value--error">
            Failed to detect
          </span>
        ) : (
          <>
            <span className="ip-display__value">{ip}</span>
            <span className={`ip-display__badge ${isIPv6 ? "badge--v6" : "badge--v4"}`}>
              {isIPv6 ? "IPv6 ✓" : "IPv4"}
            </span>
            <button
              className="ip-display__copy"
              onClick={copy}
              title="Copy IP"
            >
              {copied ? "✓ Copied" : "Copy"}
            </button>
          </>
        )}
      </div>
      {!loading && !error && !isIPv6 && (
        <p className="ip-display__hint">
          ⚠ No global IPv6 detected. WebRTC will use IPv4. Enable IPv6 in your
          network settings for direct IPv6 P2P.
        </p>
      )}
    </div>
  );
}
