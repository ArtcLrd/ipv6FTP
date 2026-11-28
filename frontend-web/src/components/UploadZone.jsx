import { useRef, useState, useCallback } from "react";

export function UploadZone({ onFilesAdded, disabled }) {
  const inputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  const processFiles = useCallback(
    (files) => {
      if (disabled) return;
      Array.from(files).forEach((file) => onFilesAdded(file));
    },
    [disabled, onFilesAdded]
  );

  const onDragOver = (e) => {
    e.preventDefault();
    if (!disabled) setIsDragging(true);
  };

  const onDragLeave = () => setIsDragging(false);

  const onDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    processFiles(e.dataTransfer.files);
  };

  const onInputChange = (e) => {
    processFiles(e.target.files);
    // Reset input so the same file can be re-added if removed
    e.target.value = "";
  };

  return (
    <div
      className={`upload-zone ${isDragging ? "upload-zone--dragging" : ""} ${
        disabled ? "upload-zone--disabled" : ""
      }`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={() => !disabled && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={onInputChange}
      />
      <div className="upload-zone__icon">
        {isDragging ? "📂" : "＋"}
      </div>
      <div className="upload-zone__text">
        {disabled
          ? "Connect to a peer before sharing files"
          : isDragging
          ? "Drop files here"
          : "Drag & drop files or click to select"}
      </div>
      <div className="upload-zone__sub">
        Files will be shared with your connected peer
      </div>
    </div>
  );
}
