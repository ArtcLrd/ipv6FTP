import { formatBytes, calcSpeed } from "../lib/fileChunker";

export function TransferProgress({ transfers }) {
  const active = transfers.filter((t) => !t.done);
  const completed = transfers.filter((t) => t.done);

  if (transfers.length === 0) return null;

  return (
    <div className="transfer-progress">
      <h3 className="transfer-progress__title">Transfers</h3>

      {active.length > 0 && (
        <div className="transfer-section">
          <div className="transfer-section__label">Active</div>
          {active.map((t) => {
            const pct = t.total > 0 ? Math.round((t.bytes / t.total) * 100) : 0;
            const elapsed = Date.now() - t.startTime;
            const speed = calcSpeed(t.bytes, elapsed);
            return (
              <div key={t.id} className="transfer-item">
                <div className="transfer-item__header">
                  <span className="transfer-item__direction">
                    {t.direction === "upload" ? "↑ Upload" : "↓ Download"}
                  </span>
                  <span className="transfer-item__name" title={t.name}>
                    {t.name}
                  </span>
                  <span className="transfer-item__speed">{speed}</span>
                </div>
                <div className="transfer-item__bar-track">
                  <div
                    className="transfer-item__bar-fill"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="transfer-item__footer">
                  <span>
                    {formatBytes(t.bytes)} / {formatBytes(t.total)}
                  </span>
                  <span>{pct}%</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {completed.length > 0 && (
        <div className="transfer-section">
          <div className="transfer-section__label">Completed</div>
          {completed.slice(-5).map((t) => (
            <div key={t.id} className="transfer-item transfer-item--done">
              <span className="transfer-item__direction">
                {t.direction === "upload" ? "↑" : "↓"}
              </span>
              <span className="transfer-item__name">{t.name}</span>
              <span className="transfer-item__done-badge">✓ {formatBytes(t.total)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
