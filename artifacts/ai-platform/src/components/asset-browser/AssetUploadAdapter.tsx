/**
 * AssetUploadAdapter.tsx — Upload entry point using existing storage API (Team 14)
 *
 * Two-step presigned URL flow (same as CpAssetUploader / UploadDropzone):
 *   1. POST /api/storage/uploads/request-url  → { uploadURL, objectPath }
 *   2. PUT <uploadURL>                         → bytes go straight to object storage
 *
 * Security:
 * - No base64 in state (uses object URLs + XHR stream)
 * - Raw SVG is never rendered as innerHTML
 * - Object URLs are revoked on unmount
 * - Filename sanitized before display
 * - MIME + extension + size validated via validateUploadFile()
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { Upload, X, CheckCircle2, AlertCircle, Loader2, Image, FileText, File } from "lucide-react";
import { cn } from "@/lib/utils";
import { validateUploadFile } from "./types";
import { fmtFileSize } from "./AssetCard";
import type { UploadEntry, UploadStatus } from "./types";
import { nanoid } from "./internal-nanoid";

// ── Internal helpers ───────────────────────────────────────────────────────────

function sanitizeFileName(name: string): string {
  return name.replace(/[<>"'\\]/g, "_");
}

function FileIcon({ mime }: { mime: string }) {
  if (mime.startsWith("image/")) return <Image className="w-4 h-4 text-blue-400" />;
  if (mime === "application/pdf") return <FileText className="w-4 h-4 text-red-400" />;
  return <File className="w-4 h-4 text-muted-foreground" />;
}

function statusIcon(status: UploadStatus) {
  switch (status) {
    case "uploading":
    case "requesting":
      return <Loader2 className="w-4 h-4 animate-spin text-primary" />;
    case "complete":
      return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    case "error":
      return <AlertCircle className="w-4 h-4 text-destructive" />;
    default:
      return null;
  }
}

// ── Upload logic ───────────────────────────────────────────────────────────────

async function requestUploadUrl(
  file: File,
): Promise<{ uploadURL: string; objectPath: string }> {
  const res = await fetch("/api/storage/uploads/request-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: sanitizeFileName(file.name),
      size: file.size,
      contentType: file.type || "application/octet-stream",
    }),
  });
  if (!res.ok) {
    let msg = "Gagal membuat URL upload";
    try { const b = await res.json() as { error?: string }; if (b.error) msg = b.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<{ uploadURL: string; objectPath: string }>;
}

function uploadViaXHR(
  file: File,
  uploadURL: string,
  onProgress: (pct: number) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadURL);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload gagal (status ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload gagal — periksa koneksi"));
    xhr.onabort = () => reject(new Error("Upload dibatalkan"));
    signal.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface UploadResult {
  objectPath: string;
  previewUrl: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
}

interface AssetUploadAdapterProps {
  onComplete?: (result: UploadResult) => void;
  onError?: (error: string) => void;
  accept?: string;
  maxSizeMB?: number;
  multiple?: boolean;
  disabled?: boolean;
  className?: string;
}

export function AssetUploadAdapter({
  onComplete,
  onError,
  accept = "image/*,application/pdf,video/mp4,video/webm,font/ttf,font/otf,font/woff,font/woff2",
  maxSizeMB = 50,
  multiple = false,
  disabled,
  className,
}: AssetUploadAdapterProps) {
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRefs = useRef<Map<string, AbortController>>(new Map());

  // Revoke object URLs on unmount
  useEffect(() => {
    const entriesCopy = entries;
    return () => {
      for (const e of entriesCopy) {
        if (e.objectUrl) URL.revokeObjectURL(e.objectUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function patchEntry(id: string, patch: Partial<UploadEntry>) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  async function processFile(file: File) {
    const validation = validateUploadFile(file);
    if (!validation.valid) {
      onError?.(validation.error!);
      return;
    }

    const id = nanoid();
    const objectUrl = URL.createObjectURL(file);
    const entry: UploadEntry = {
      id,
      file,
      status: "requesting",
      progress: 0,
      error: null,
      objectUrl,
      storagePath: null,
      previewUrl: null,
    };
    setEntries((prev) => [...prev, entry]);

    const ac = new AbortController();
    abortRefs.current.set(id, ac);

    try {
      patchEntry(id, { status: "requesting" });
      const { uploadURL, objectPath } = await requestUploadUrl(file);

      patchEntry(id, { status: "uploading" });
      await uploadViaXHR(file, uploadURL, (pct) => patchEntry(id, { progress: pct }), ac.signal);

      const previewUrl = `/api/storage${objectPath}`;
      patchEntry(id, { status: "complete", progress: 100, storagePath: objectPath, previewUrl });
      URL.revokeObjectURL(objectUrl);
      patchEntry(id, { objectUrl: null });

      onComplete?.({
        objectPath,
        previewUrl,
        fileName: sanitizeFileName(file.name),
        mimeType: file.type || "application/octet-stream",
        fileSizeBytes: file.size,
      });
    } catch (err) {
      const msg = (err as Error).message;
      const isCancelled = msg.includes("dibatalkan");
      patchEntry(id, { status: isCancelled ? "cancelled" : "error", error: isCancelled ? null : msg });
      if (!isCancelled) onError?.(msg);
    } finally {
      abortRefs.current.delete(id);
    }
  }

  function handleFiles(fileList: FileList | null) {
    if (!fileList || disabled) return;
    const files = Array.from(fileList).slice(0, multiple ? undefined : 1);
    void Promise.all(files.map(processFile));
  }

  function cancel(id: string) {
    abortRefs.current.get(id)?.abort();
    setEntries((prev) => {
      const entry = prev.find((e) => e.id === id);
      if (entry?.objectUrl) URL.revokeObjectURL(entry.objectUrl);
      return prev.filter((e) => e.id !== id);
    });
  }

  function remove(id: string) {
    setEntries((prev) => {
      const entry = prev.find((e) => e.id === id);
      if (entry?.objectUrl) URL.revokeObjectURL(entry.objectUrl);
      return prev.filter((e) => e.id !== id);
    });
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* Drop zone */}
      <div
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onClick={() => !disabled && inputRef.current?.click()}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Upload area — drag dan drop file atau klik untuk memilih"
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
        className={cn(
          "flex flex-col items-center justify-center gap-3 p-8 rounded-2xl border-2 border-dashed",
          "cursor-pointer transition-all duration-200 text-center select-none",
          dragging
            ? "border-primary bg-primary/10"
            : "border-border/50 bg-muted/20 hover:border-primary/40 hover:bg-primary/5",
          disabled && "opacity-40 cursor-not-allowed",
        )}
      >
        <div className={cn(
          "w-12 h-12 rounded-2xl flex items-center justify-center transition-colors",
          dragging ? "bg-primary/20" : "bg-primary/10",
        )}>
          <Upload className={cn("w-5 h-5", dragging ? "text-primary" : "text-primary/70")} />
        </div>
        <div>
          <p className="text-sm font-medium">Drag &amp; drop file ke sini</p>
          <p className="text-xs text-muted-foreground mt-1">atau klik untuk memilih · Maks. {maxSizeMB} MB</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          onChange={(e) => handleFiles(e.target.files)}
          className="sr-only"
          aria-hidden
        />
      </div>

      {/* Upload list */}
      {entries.map((entry) => (
        <div
          key={entry.id}
          className={cn(
            "flex items-center gap-3 p-3 rounded-xl border border-border/50 bg-card",
            entry.status === "error" && "border-destructive/30 bg-destructive/5",
            entry.status === "complete" && "border-green-500/20",
          )}
        >
          <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
            {statusIcon(entry.status) ?? <FileIcon mime={entry.file.type} />}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{sanitizeFileName(entry.file.name)}</p>
            {entry.status === "uploading" && (
              <div className="mt-1 h-1 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-200"
                  style={{ width: `${entry.progress}%` }}
                />
              </div>
            )}
            {entry.status === "error" && entry.error && (
              <p className="text-xs text-destructive mt-0.5">{entry.error}</p>
            )}
            {entry.status === "complete" && (
              <p className="text-xs text-green-600 mt-0.5">Upload selesai · {fmtFileSize(entry.file.size)}</p>
            )}
            {(entry.status === "idle" || entry.status === "requesting") && (
              <p className="text-xs text-muted-foreground">{fmtFileSize(entry.file.size)}</p>
            )}
          </div>

          <button
            onClick={() => entry.status === "uploading" || entry.status === "requesting" ? cancel(entry.id) : remove(entry.id)}
            aria-label={entry.status === "uploading" ? `Batalkan upload ${entry.file.name}` : `Hapus ${entry.file.name}`}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
