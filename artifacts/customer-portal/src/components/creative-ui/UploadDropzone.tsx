import {
  memo,
  useState,
  useRef,
  useCallback,
  DragEvent,
  ChangeEvent,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, X, FileText, Image as ImageIcon, File, CheckCircle2, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  url?: string;
  /** upload progress 0-100, undefined means complete */
  progress?: number;
  error?: string;
}

interface UploadDropzoneProps {
  files: UploadedFile[];
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  accept?: string;
  multiple?: boolean;
  maxSizeMB?: number;
  disabled?: boolean;
  className?: string;
  label?: string;
  hint?: string;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileIcon({ type }: { type: string }) {
  if (type.startsWith("image/")) return <ImageIcon className="w-4 h-4 text-cyan-400" />;
  if (type === "application/pdf") return <FileText className="w-4 h-4 text-red-400" />;
  return <File className="w-4 h-4 text-muted-foreground" />;
}

export const UploadDropzone = memo(function UploadDropzone({
  files,
  onAdd,
  onRemove,
  accept = "image/*,application/pdf",
  multiple = true,
  maxSizeMB = 10,
  disabled,
  className,
  label = "Drag & drop file ke sini",
  hint,
}: UploadDropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const validate = useCallback(
    (file: File): boolean => {
      const maxBytes = maxSizeMB * 1024 * 1024;
      return file.size <= maxBytes;
    },
    [maxSizeMB],
  );

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || disabled) return;
      const valid = Array.from(fileList).filter(validate);
      if (valid.length) onAdd(valid);
    },
    [onAdd, disabled, validate],
  );

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };
  const onDragLeave = () => setDragging(false);
  const onChange = (e: ChangeEvent<HTMLInputElement>) => handleFiles(e.target.files);

  return (
    <div className={cn("space-y-3", className)}>
      {/* Drop zone */}
      <motion.div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        animate={dragging ? { scale: 1.01 } : { scale: 1 }}
        transition={{ duration: 0.15 }}
        onClick={() => !disabled && inputRef.current?.click()}
        className={cn(
          "relative flex flex-col items-center justify-center gap-3 p-8 rounded-2xl border-2 border-dashed cursor-pointer",
          "transition-all duration-200 text-center",
          dragging
            ? "border-primary bg-primary/10 shadow-[0_0_24px_-4px_rgba(124,110,250,0.4)]"
            : "border-border/50 bg-surface-1 hover:border-primary/40 hover:bg-primary/5",
          disabled && "opacity-40 cursor-not-allowed",
        )}
      >
        <div
          className={cn(
            "w-12 h-12 rounded-2xl flex items-center justify-center transition-colors duration-200",
            dragging ? "bg-primary/20" : "bg-primary/10",
          )}
        >
          <Upload className={cn("w-5 h-5 transition-colors duration-200", dragging ? "text-primary" : "text-primary/70")} />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {hint ?? `atau klik untuk memilih · Maks. ${maxSizeMB}MB per file`}
          </p>
          <p className="text-xs text-muted-foreground/60 mt-0.5">
            {accept.replace(/application\//g, "").replace(/\*/g, "semua").split(",").join(", ")}
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          onChange={onChange}
          className="sr-only"
          aria-label="Upload file"
        />
      </motion.div>

      {/* File list */}
      <AnimatePresence mode="popLayout">
        {files.map((f) => (
          <motion.div
            key={f.id}
            layout
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.2 }}
            className={cn(
              "flex items-center gap-3 p-3 rounded-xl border border-border/50 bg-surface-1",
              f.error && "border-destructive/30 bg-destructive/5",
            )}
          >
            {/* Icon */}
            <div className="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center shrink-0">
              {f.progress !== undefined && f.progress < 100 ? (
                <Loader2 className="w-4 h-4 text-primary animate-spin" />
              ) : f.error ? (
                <X className="w-4 h-4 text-destructive" />
              ) : (
                <FileIcon type={f.type} />
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{f.name}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <p className="text-[10px] text-muted-foreground">{formatBytes(f.size)}</p>
                {f.error && (
                  <p className="text-[10px] text-destructive">{f.error}</p>
                )}
              </div>
              {/* Progress bar */}
              {f.progress !== undefined && f.progress < 100 && !f.error && (
                <div className="mt-1.5 h-1 rounded-full bg-surface-2 overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-primary"
                    initial={{ width: 0 }}
                    animate={{ width: `${f.progress}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              )}
            </div>

            {/* Status / remove */}
            <div className="flex items-center gap-1.5 shrink-0">
              {f.progress === 100 && !f.error && (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              )}
              {/* Preview for images */}
              {f.url && f.type.startsWith("image/") && (
                <img
                  src={f.url}
                  alt={f.name}
                  className="w-8 h-8 rounded-lg object-cover border border-border/40"
                />
              )}
              <button
                type="button"
                onClick={() => onRemove(f.id)}
                aria-label={`Hapus ${f.name}`}
                className="w-6 h-6 rounded-lg hover:bg-destructive/10 hover:text-destructive flex items-center justify-center transition-colors text-muted-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
});

UploadDropzone.displayName = "UploadDropzone";
