import { useState, useRef, useCallback, useEffect } from "react";
import { chunkFile, FileReceiver, CHUNK_SIZE } from "../lib/fileChunker";

/**
 * useFileTransfer — manages file sending and receiving over a WebRTC DataChannel.
 *
 * @param {RTCDataChannel|null} channel — the open DataChannel
 * @returns {{ sharedFiles, addSharedFile, removeSharedFile,
 *             remoteFiles, transfers, sendFile }}
 */
export function useFileTransfer(channel) {
  // Files this user has "shared" (their manifest sent to the remote peer)
  const [sharedFiles, setSharedFiles] = useState([]);
  // Files the remote peer has shared (their manifest received via DataChannel)
  const [remoteFiles, setRemoteFiles] = useState([]);
  // Active transfers: { id, name, size, bytes, total, direction, startTime }
  const [transfers, setTransfers] = useState([]);

  // In-progress file receiver (for incoming chunks)
  const receiverRef = useRef(null);
  const activeTransferIdRef = useRef(null);

  // Send our file manifest to the peer whenever our shared files change
  // Also called when the channel first opens
  const sendManifest = useCallback(
    (ch, files) => {
      if (!ch || ch.readyState !== "open") return;
      const manifest = files.map(({ name, size, type }) => ({ name, size, type }));
      ch.send(JSON.stringify({ type: "manifest", files: manifest }));
    },
    []
  );

  // When channel opens, send our current manifest
  useEffect(() => {
    if (channel && channel.readyState === "open") {
      sendManifest(channel, sharedFiles);
    }
  }, [channel, sharedFiles, sendManifest]);

  // Handle incoming DataChannel messages
  useEffect(() => {
    if (!channel) return;

    const handleMessage = async (event) => {
      const data = event.data;

      if (typeof data === "string") {
        // JSON control message
        let msg;
        try {
          msg = JSON.parse(data);
        } catch {
          return;
        }

        switch (msg.type) {
          case "manifest":
            setRemoteFiles(msg.files || []);
            break;

          case "file-start": {
            const receiver = new FileReceiver(msg);
            receiverRef.current = receiver;
            const id = `recv-${Date.now()}`;
            activeTransferIdRef.current = id;
            setTransfers((prev) => [
              ...prev,
              {
                id,
                name: msg.name,
                size: msg.size,
                bytes: 0,
                total: msg.size,
                direction: "download",
                startTime: Date.now(),
              },
            ]);
            break;
          }

          case "file-end": {
            const receiver = receiverRef.current;
            if (receiver && receiver.isComplete()) {
              await receiver.save();
            }
            receiverRef.current = null;
            // Mark transfer complete
            const tid = activeTransferIdRef.current;
            setTransfers((prev) =>
              prev.map((t) => (t.id === tid ? { ...t, done: true } : t))
            );
            activeTransferIdRef.current = null;
            break;
          }

          case "request-file":
            // Remote peer is requesting one of our shared files
            handleFileRequest(msg.name, channel);
            break;

          default:
            break;
        }
      } else if (data instanceof ArrayBuffer) {
        // Binary chunk
        const receiver = receiverRef.current;
        if (!receiver) return;
        receiver.addChunk(data);

        const tid = activeTransferIdRef.current;
        setTransfers((prev) =>
          prev.map((t) =>
            t.id === tid
              ? { ...t, bytes: receiver.bytesReceived }
              : t
          )
        );
      }
    };

    channel.addEventListener("message", handleMessage);
    return () => channel.removeEventListener("message", handleMessage);
  }, [channel]);

  /**
   * Sends a file from our shared list to the remote peer.
   * The remote peer requests it by name via a "request-file" message.
   */
  const handleFileRequest = useCallback(
    async (name, ch) => {
      const fileObj = sharedFiles.find((f) => f.name === name);
      if (!fileObj) return;

      const id = `send-${Date.now()}`;
      setTransfers((prev) => [
        ...prev,
        {
          id,
          name: fileObj.name,
          size: fileObj.file.size,
          bytes: 0,
          total: fileObj.file.size,
          direction: "upload",
          startTime: Date.now(),
        },
      ]);

      let bytesSent = 0;
      for await (const item of chunkFile(fileObj.file)) {
        if (item.type === "chunk") {
          // Flow control: wait if the buffer is too full
          while (ch.bufferedAmount > CHUNK_SIZE * 16) {
            await new Promise((r) => setTimeout(r, 10));
          }
          ch.send(item.data);
          bytesSent += item.data.byteLength;
          setTransfers((prev) =>
            prev.map((t) => (t.id === id ? { ...t, bytes: bytesSent } : t))
          );
        } else if (item.type === "file-start" || item.type === "file-end") {
          ch.send(JSON.stringify(item));
        }
      }

      setTransfers((prev) =>
        prev.map((t) => (t.id === id ? { ...t, done: true } : t))
      );
    },
    [sharedFiles]
  );

  /**
   * Download a file from the remote peer by requesting it via DataChannel.
   */
  const requestFile = useCallback(
    (name) => {
      if (channel && channel.readyState === "open") {
        channel.send(JSON.stringify({ type: "request-file", name }));
      }
    },
    [channel]
  );

  const addSharedFile = useCallback((file) => {
    setSharedFiles((prev) => {
      if (prev.find((f) => f.name === file.name)) return prev;
      return [...prev, { name: file.name, size: file.size, type: file.type, file }];
    });
  }, []);

  const removeSharedFile = useCallback((name) => {
    setSharedFiles((prev) => prev.filter((f) => f.name !== name));
  }, []);

  return {
    sharedFiles,
    addSharedFile,
    removeSharedFile,
    remoteFiles,
    transfers,
    requestFile,
  };
}
