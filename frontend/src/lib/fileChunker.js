// fileChunker.js
// Handles splitting files into chunks for DataChannel transmission
// and reassembling received chunks back into a Blob.

export const CHUNK_SIZE = 64 * 1024; // 64KB per chunk

/**
 * Reads a File object as an ArrayBuffer and splits it into chunks.
 * Each chunk is preceded by a metadata JSON message on the DataChannel.
 *
 * Protocol (sender side):
 *   1. Send JSON: { type: "file-start", name, size, mimeType, totalChunks }
 *   2. Send ArrayBuffer chunks sequentially
 *   3. Send JSON: { type: "file-end", name }
 */
export async function* chunkFile(file) {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

  // Yield the header metadata first
  yield {
    type: "file-start",
    name: file.name,
    size: file.size,
    mimeType: file.type || "application/octet-stream",
    totalChunks,
  };

  // Yield each binary chunk
  let offset = 0;
  let chunkIndex = 0;
  while (offset < file.size) {
    const slice = file.slice(offset, offset + CHUNK_SIZE);
    const buffer = await slice.arrayBuffer();
    yield { type: "chunk", data: buffer, chunkIndex };
    offset += CHUNK_SIZE;
    chunkIndex++;
  }

  // Yield the end marker
  yield { type: "file-end", name: file.name };
}

/**
 * FileReceiver accumulates incoming DataChannel messages for a single file.
 * Usage:
 *   const receiver = new FileReceiver(metadata)
 *   receiver.addChunk(arrayBuffer)
 *   if (receiver.isComplete()) receiver.save()
 */
export class FileReceiver {
  constructor({ name, size, mimeType, totalChunks }) {
    this.name = name;
    this.size = size;
    this.mimeType = mimeType;
    this.totalChunks = totalChunks;
    this.chunks = [];
    this.receivedChunks = 0;
    this.bytesReceived = 0;
  }

  addChunk(buffer) {
    this.chunks.push(buffer);
    this.receivedChunks++;
    this.bytesReceived += buffer.byteLength;
  }

  get progress() {
    return this.size > 0 ? this.bytesReceived / this.size : 0;
  }

  isComplete() {
    return this.receivedChunks >= this.totalChunks;
  }

  /**
   * Saves the reassembled file.
   * Uses showSaveFilePicker() in Chrome/Edge for folder selection.
   * Falls back to <a download> for Firefox/Safari.
   */
  async save() {
    const blob = new Blob(this.chunks, { type: this.mimeType });

    if ("showSaveFilePicker" in window) {
      try {
        // Chrome/Edge: let user choose save location
        const fileHandle = await window.showSaveFilePicker({
          suggestedName: this.name,
          types: [
            {
              description: "File",
              accept: { [this.mimeType]: [] },
            },
          ],
        });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (err) {
        if (err.name === "AbortError") {
          // User cancelled the save dialog — do nothing
          return;
        }
        // Other error: fall through to <a> download
        console.warn("showSaveFilePicker failed, falling back:", err);
      }
    }

    // Firefox / Safari fallback: trigger browser auto-download
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = this.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Clean up the object URL after a short delay
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

/** Format bytes to human-readable string */
export function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/** Calculate transfer speed */
export function calcSpeed(bytesTransferred, elapsedMs) {
  if (elapsedMs === 0) return "—";
  const mbps = (bytesTransferred / (1024 * 1024)) / (elapsedMs / 1000);
  return `${mbps.toFixed(2)} MB/s`;
}
