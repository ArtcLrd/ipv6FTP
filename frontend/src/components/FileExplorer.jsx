import { formatBytes } from "../lib/fileChunker";

function fileIcon(type) {
  if (!type) return "📄";
  if (type.startsWith("image/")) return "🖼";
  if (type.startsWith("video/")) return "🎬";
  if (type.startsWith("audio/")) return "🎵";
  if (type.includes("pdf")) return "📕";
  if (type.includes("zip") || type.includes("tar") || type.includes("gzip")) return "🗜";
  if (type.includes("text")) return "📝";
  return "📄";
}

export function FileExplorer({
  sharedFiles,
  remoteFiles,
  onRemove,
  onDownload,
  isConnected,
}) {
  return (
    <div className="file-explorer">
      {/* ── My Shared Files ── */}
      <div className="file-pane">
        <div className="file-pane__header">
          <span className="file-pane__title">📁 My Shared Files</span>
          <span className="file-pane__count">{sharedFiles.length} files</span>
        </div>

        {sharedFiles.length === 0 ? (
          <div className="file-pane__empty">
            No files shared yet. <br />
            Drag &amp; drop or use the upload zone below.
          </div>
        ) : (
          <ul className="file-list">
            {sharedFiles.map((f) => (
              <li key={f.name} className="file-item">
                <span className="file-item__icon">{fileIcon(f.type)}</span>
                <div className="file-item__info">
                  <span className="file-item__name" title={f.name}>
                    {f.name}
                  </span>
                  <span className="file-item__size">{formatBytes(f.size)}</span>
                </div>
                <button
                  className="btn btn--danger-ghost"
                  onClick={() => onRemove(f.name)}
                  title="Remove from shared list"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Remote Peer's Files ── */}
      <div className="file-pane">
        <div className="file-pane__header">
          <span className="file-pane__title">🌐 Remote Peer's Files</span>
          <span className="file-pane__count">{remoteFiles.length} files</span>
        </div>

        {!isConnected ? (
          <div className="file-pane__empty">Connect to a peer to see their files.</div>
        ) : remoteFiles.length === 0 ? (
          <div className="file-pane__empty">
            Connected — peer has no shared files yet.
          </div>
        ) : (
          <ul className="file-list">
            {remoteFiles.map((f) => (
              <li key={f.name} className="file-item">
                <span className="file-item__icon">{fileIcon(f.type)}</span>
                <div className="file-item__info">
                  <span className="file-item__name" title={f.name}>
                    {f.name}
                  </span>
                  <span className="file-item__size">{formatBytes(f.size)}</span>
                </div>
                <button
                  className="btn btn--primary-sm"
                  onClick={() => onDownload(f.name)}
                  title="Download this file from peer"
                >
                  ↓ Download
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
