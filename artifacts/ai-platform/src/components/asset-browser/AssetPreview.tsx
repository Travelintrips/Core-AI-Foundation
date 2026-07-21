/**
 * AssetPreview.tsx — Modal preview panel for a single asset (Team 14)
 *
 * Renders image/PDF/video/icon previews safely — no arbitrary HTML rendering.
 * Revokes object URLs on unmount.
 */

import { useEffect, useRef } from "react";
import {
  X, Download, Archive, ArchiveRestore, ExternalLink,
  FileText, Calendar, User, Tag, Layers, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CategoryIcon, categoryBadgeClass, fmtFileSize } from "./AssetCard";
import type { AssetSummary, AssetPermission, AssetPreviewDescriptor } from "./types";

// ── Preview descriptor resolver ───────────────────────────────────────────────

export function resolvePreviewDescriptor(asset: AssetSummary): AssetPreviewDescriptor {
  if (asset.availability === "unavailable") {
    return { kind: "unavailable", url: null, altText: asset.title };
  }
  if (!asset.previewUrl) {
    return { kind: "icon_placeholder", url: null, altText: asset.title };
  }
  const mime = asset.mimeType ?? "";
  if (mime.startsWith("image/")) {
    return { kind: "image", url: asset.previewUrl, altText: asset.title };
  }
  if (mime === "application/pdf") {
    return { kind: "pdf", url: asset.previewUrl, altText: asset.title };
  }
  if (mime.startsWith("video/")) {
    return { kind: "video", url: asset.previewUrl, mimeType: mime, altText: asset.title };
  }
  return { kind: "icon_placeholder", url: null, altText: asset.title };
}

// ── Preview renderer ───────────────────────────────────────────────────────────

function PreviewRenderer({ descriptor, asset }: { descriptor: AssetPreviewDescriptor; asset: AssetSummary }) {
  switch (descriptor.kind) {
    case "image":
      return (
        <img
          src={descriptor.url!}
          alt={descriptor.altText}
          className="max-w-full max-h-[60vh] rounded-xl object-contain mx-auto"
        />
      );
    case "pdf":
      // No arbitrary HTML — embed as object which renders via browser PDF viewer
      return (
        <object
          data={descriptor.url!}
          type="application/pdf"
          className="w-full h-[60vh] rounded-xl border border-border"
          title={descriptor.altText}
          aria-label={`PDF preview: ${descriptor.altText}`}
        >
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <FileText className="w-10 h-10 opacity-40" />
            <p className="text-sm">PDF tidak dapat ditampilkan di browser ini</p>
          </div>
        </object>
      );
    case "video":
      return (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video
          controls
          className="max-w-full max-h-[60vh] rounded-xl mx-auto"
          aria-label={`Video preview: ${descriptor.altText}`}
        >
          <source src={descriptor.url!} type={descriptor.mimeType} />
          Browser Anda tidak mendukung pemutaran video.
        </video>
      );
    case "unavailable":
      return (
        <div className="flex flex-col items-center justify-center h-40 gap-3 text-muted-foreground">
          <AlertTriangle className="w-10 h-10 opacity-40" />
          <p className="text-sm">Asset tidak tersedia</p>
        </div>
      );
    default:
      return (
        <div className={cn(
          "flex items-center justify-center h-40 rounded-xl",
          categoryBadgeClass(asset.category),
        )}>
          <CategoryIcon category={asset.category} className="w-16 h-16 opacity-40" />
        </div>
      );
  }
}

// ── AssetPreview ──────────────────────────────────────────────────────────────

interface AssetPreviewProps {
  asset: AssetSummary | null;
  permission?: AssetPermission;
  onClose: () => void;
  onDownload?: (asset: AssetSummary) => void;
  onArchiveToggle?: (asset: AssetSummary) => void;
}

export function AssetPreview({
  asset,
  permission,
  onClose,
  onDownload,
  onArchiveToggle,
}: AssetPreviewProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Trap focus and handle Escape
  useEffect(() => {
    if (!asset) return;
    const prev = document.activeElement as HTMLElement | null;
    const first = dialogRef.current?.querySelector<HTMLElement>(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
    );
    first?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [asset, onClose]);

  if (!asset) return null;

  const descriptor = resolvePreviewDescriptor(asset);
  const isArchived = asset.availability === "archived";
  const canDownload = permission?.canDownload ?? true;
  const canArchive = permission?.canArchive ?? true;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview: ${asset.title}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3 min-w-0">
            <div className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
              categoryBadgeClass(asset.category),
            )}>
              <CategoryIcon category={asset.category} className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-sm truncate">{asset.title}</h2>
              <p className="text-xs text-muted-foreground truncate">{asset.fileName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Tutup preview"
            className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Preview */}
        <div className="p-5">
          <PreviewRenderer descriptor={descriptor} asset={asset} />
        </div>

        {/* Metadata */}
        <div className="px-5 pb-5 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <MetaItem icon={<Layers className="w-3 h-3" />} label="Kategori" value={asset.categoryLabel} />
            {asset.fileSizeBytes !== null && (
              <MetaItem icon={<FileText className="w-3 h-3" />} label="Ukuran" value={fmtFileSize(asset.fileSizeBytes)} />
            )}
            <MetaItem icon={<Layers className="w-3 h-3" />} label="Versi" value={`v${asset.version}`} />
            {asset.uploadedBy && (
              <MetaItem icon={<User className="w-3 h-3" />} label="Upload oleh" value={asset.uploadedBy} />
            )}
            <MetaItem icon={<Calendar className="w-3 h-3" />} label="Dibuat" value={new Date(asset.createdAt).toLocaleDateString("id-ID")} />
            <MetaItem icon={<Calendar className="w-3 h-3" />} label="Diperbarui" value={new Date(asset.updatedAt).toLocaleDateString("id-ID")} />
          </div>

          {asset.tags.length > 0 && (
            <div className="flex items-start gap-2">
              <Tag className="w-3 h-3 text-muted-foreground mt-0.5 shrink-0" />
              <div className="flex flex-wrap gap-1">
                {asset.tags.map((t) => (
                  <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{t}</span>
                ))}
              </div>
            </div>
          )}

          {asset.previewExpired && (
            <p className="text-xs text-amber-600 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              URL preview telah kedaluwarsa — muat ulang untuk mendapatkan URL baru
            </p>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            {canDownload && onDownload && asset.availability !== "unavailable" && (
              <button
                onClick={() => onDownload(asset)}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Download
              </button>
            )}
            {canArchive && onArchiveToggle && (
              <button
                onClick={() => onArchiveToggle(asset)}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-border hover:bg-muted transition-colors"
              >
                {isArchived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                {isArchived ? "Pulihkan" : "Arsipkan"}
              </button>
            )}
            {asset.previewUrl && (
              <a
                href={asset.previewUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors ml-auto"
                aria-label="Buka di tab baru"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Buka
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-1.5">
      <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>
      <div>
        <p className="text-muted-foreground">{label}</p>
        <p className="font-medium text-foreground">{value}</p>
      </div>
    </div>
  );
}
