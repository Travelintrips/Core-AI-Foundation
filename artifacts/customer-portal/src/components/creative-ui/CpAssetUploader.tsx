import { memo, useCallback, useEffect, useRef, useState } from "react";
import { UploadDropzone, type UploadedFile } from "./UploadDropzone";
import { uploadFileToStorage } from "@/lib/use-object-upload";

/**
 * Real file-upload field for the Company Profile brief (Step 4).
 *
 * Replaces the old "paste a Google Drive link" text inputs with a real
 * drag-and-drop upload to object storage. The brief field itself stays a
 * plain string (comma-separated URLs when `multiple`) so no backend schema
 * change is required — `companyProfileBriefIntelligence.ts` and
 * `companyProfileDocumentMapper.ts` keep reading it exactly as before.
 */
interface CpAssetUploaderProps {
  /** Comma-separated list of already-uploaded URLs (the brief field value). */
  value: string;
  onChange: (value: string) => void;
  accept?: string;
  multiple?: boolean;
  maxSizeMB?: number;
  label?: string;
  hint?: string;
}

function filenameFromUrl(url: string): string {
  try {
    const path = url.split("?")[0] ?? url;
    const last = path.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : url;
  } catch {
    return url;
  }
}

function seedFromValue(value: string): UploadedFile[] {
  const urls = value ? value.split(",").map((s) => s.trim()).filter(Boolean) : [];
  return urls.map((url) => ({
    id: url,
    name: filenameFromUrl(url),
    size: 0,
    type: /\.(png|jpe?g|webp|gif|svg)$/i.test(url) ? "image/*" : "application/octet-stream",
    url,
    progress: 100,
  }));
}

export const CpAssetUploader = memo(function CpAssetUploader({
  value,
  onChange,
  accept,
  multiple = true,
  maxSizeMB = 10,
  label,
  hint,
}: CpAssetUploaderProps) {
  const [files, setFiles] = useState<UploadedFile[]>(() => seedFromValue(value));

  // Re-seed only when the incoming value changes from *outside* this
  // component (e.g. loading a saved draft) — not on every keystroke-driven
  // re-render caused by our own onChange calls below.
  const lastCommitted = useRef(value);
  useEffect(() => {
    if (value !== lastCommitted.current) {
      lastCommitted.current = value;
      setFiles(seedFromValue(value));
    }
  }, [value]);

  const commit = useCallback((next: UploadedFile[]) => {
    const urls = next.filter((f) => f.url && !f.error).map((f) => f.url as string);
    const joined = urls.join(", ");
    lastCommitted.current = joined;
    onChange(joined);
  }, [onChange]);

  const handleAdd = useCallback((newFiles: File[]) => {
    for (const file of newFiles) {
      const id = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setFiles((prev) => [...prev, { id, name: file.name, size: file.size, type: file.type, progress: 0 }]);

      uploadFileToStorage(file, (pct) => {
        setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, progress: pct } : f)));
      })
        .then(({ url }) => {
          setFiles((prev) => {
            const next = prev.map((f) => (f.id === id ? { ...f, url, progress: 100 } : f));
            commit(next);
            return next;
          });
        })
        .catch((err: unknown) => {
          setFiles((prev) =>
            prev.map((f) => (f.id === id ? { ...f, error: err instanceof Error ? err.message : "Upload gagal" } : f)),
          );
        });
    }
  }, [commit]);

  const handleRemove = useCallback((id: string) => {
    setFiles((prev) => {
      const next = prev.filter((f) => f.id !== id);
      commit(next);
      return next;
    });
  }, [commit]);

  return (
    <UploadDropzone
      files={files}
      onAdd={handleAdd}
      onRemove={handleRemove}
      accept={accept}
      multiple={multiple}
      maxSizeMB={maxSizeMB}
      label={label}
      hint={hint}
    />
  );
});

CpAssetUploader.displayName = "CpAssetUploader";
