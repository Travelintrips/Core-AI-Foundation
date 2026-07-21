/**
 * AssetCard.tsx — Card component for grid display (Team 14)
 *
 * Renders a single asset in grid layout. Handles selected, archived,
 * unavailable, and permission-denied states explicitly.
 */

import { useState, useCallback } from "react";
import {
  FileText, Image, FileImage, Layers, BookOpen, Grid3X3, Star,
  Download, Archive, ArchiveRestore, CheckCircle2, Lock, AlertTriangle,
  Film, Type,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AssetSummary, AssetPermission } from "./types";

// ── Category helpers ───────────────────────────────────────────────────────────

export function CategoryIcon({ category, className = "w-5 h-5" }: { category: string; className?: string }) {
  switch (category) {
    case "logo": return <Star className={className} />;
    case "photo": return <Image className={className} />;
    case "illustration": return <FileImage className={className} />;
    case "icon": return <Grid3X3 className={className} />;
    case "document": return <FileText className={className} />;
    case "brand_guideline": return <BookOpen className={className} />;
    case "generated_image": return <Layers className={className} />;
    case "uploaded_image": return <Image className={className} />;
    case "reference": return <FileImage className={className} />;
    case "font_reference": return <Type className={className} />;
    case "video_preview": return <Film className={className} />;
    default: return <FileText className={className} />;
  }
}

export function categoryBadgeClass(category: string): string {
  const map: Record<string, string> = {
    logo: "bg-yellow-500/10 text-yellow-600",
    photo: "bg-blue-500/10 text-blue-600",
    illustration: "bg-purple-500/10 text-purple-600",
    icon: "bg-green-500/10 text-green-600",
    document: "bg-primary/10 text-primary",
    brand_guideline: "bg-rose-500/10 text-rose-600",
    generated_image: "bg-teal-500/10 text-teal-600",
    uploaded_image: "bg-orange-500/10 text-orange-600",
    reference: "bg-indigo-500/10 text-indigo-600",
  };
  return map[category] ?? "bg-muted text-muted-foreground";
}

export function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── AssetCard ─────────────────────────────────────────────────────────────────

export interface AssetCardProps {
  asset: AssetSummary;
  permission?: AssetPermission;
  selected?: boolean;
  selectionMode?: "single" | "multi" | "none";
  onSelect?: (asset: AssetSummary) => void;
  onDownload?: (asset: AssetSummary) => void;
  onArchiveToggle?: (asset: AssetSummary) => void;
  onPreview?: (asset: AssetSummary) => void;
  loading?: boolean;
}

export function AssetCard({
  asset,
  permission,
  selected = false,
  selectionMode = "none",
  onSelect,
  onDownload,
  onArchiveToggle,
  onPreview,
  loading = false,
}: AssetCardProps) {
  const [imgError, setImgError] = useState(false);

  const isUnavailable = asset.availability === "unavailable";
  const isArchived = asset.availability === "archived";
  const permDenied = permission && !permission.canView;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (selectionMode !== "none") onSelect?.(asset);
        else onPreview?.(asset);
      }
    },
    [asset, selectionMode, onSelect, onPreview],
  );

  if (permDenied) {
    return (
      <div
        className="bg-card border border-card-border rounded-2xl overflow-hidden flex flex-col items-center justify-center gap-2 p-4 min-h-[160px] opacity-60"
        aria-label={`Asset ${asset.title} — akses ditolak`}
      >
        <Lock className="w-6 h-6 text-muted-foreground" />
        <p className="text-xs text-muted-foreground text-center">Akses Ditolak</p>
      </div>
    );
  }

  return (
    <div
      role={selectionMode !== "none" ? "option" : "article"}
      aria-selected={selectionMode !== "none" ? selected : undefined}
      aria-label={`Asset: ${asset.title}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onClick={() => {
        if (selectionMode !== "none") onSelect?.(asset);
        else onPreview?.(asset);
      }}
      className={cn(
        "bg-card border rounded-2xl overflow-hidden group transition-all duration-150 outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        selectionMode !== "none" ? "cursor-pointer" : "cursor-default",
        selected
          ? "border-primary ring-2 ring-primary/20"
          : "border-card-border hover:shadow-md hover:border-primary/30",
        (isUnavailable || isArchived) && "opacity-60",
      )}
    >
      {/* Preview area */}
      <div
        className={cn(
          "aspect-video relative flex items-center justify-center",
          categoryBadgeClass(asset.category).replace("text-", "bg-").replace("/10", "/5"),
          "bg-muted/30",
        )}
        onClick={(e) => { e.stopPropagation(); onPreview?.(asset); }}
      >
        {asset.previewUrl && !imgError ? (
          <img
            src={asset.previewUrl}
            alt={asset.title}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <CategoryIcon
            category={asset.category}
            className={cn("w-10 h-10 opacity-40", categoryBadgeClass(asset.category).split(" ")[1])}
          />
        )}

        {/* State overlays */}
        {isUnavailable && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm">
            <AlertTriangle className="w-6 h-6 text-muted-foreground" />
          </div>
        )}
        {isArchived && (
          <div className="absolute top-2 right-2 bg-background/80 rounded-lg px-1.5 py-0.5 text-[10px] text-muted-foreground font-medium">
            Arsip
          </div>
        )}

        {/* Selection indicator */}
        {selectionMode !== "none" && (
          <div
            className={cn(
              "absolute top-2 left-2 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all",
              selected
                ? "bg-primary border-primary"
                : "bg-background/60 border-white/60 group-hover:border-primary/60",
            )}
          >
            {selected && <CheckCircle2 className="w-3.5 h-3.5 text-primary-foreground" />}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3 space-y-2">
        <div className="min-w-0">
          <p className="font-medium text-sm truncate" title={asset.title}>{asset.title}</p>
          <p className="text-xs text-muted-foreground truncate">{asset.fileName}</p>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={cn(
            "inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full",
            categoryBadgeClass(asset.category),
          )}>
            {asset.categoryLabel}
          </span>
          <span className="text-[10px] text-muted-foreground">v{asset.version}</span>
          {asset.fileSizeBytes !== null && (
            <span className="text-[10px] text-muted-foreground">{fmtFileSize(asset.fileSizeBytes)}</span>
          )}
          {asset.previewExpired && (
            <span className="text-[10px] text-amber-600 font-medium">preview expired</span>
          )}
        </div>

        {asset.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {asset.tags.slice(0, 3).map((t) => (
              <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {t}
              </span>
            ))}
            {asset.tags.length > 3 && (
              <span className="text-[10px] text-muted-foreground">+{asset.tags.length - 3}</span>
            )}
          </div>
        )}

        {/* Action row */}
        {(permission?.canDownload ?? true) && (
          <div className="flex items-center gap-1.5 pt-1" onClick={(e) => e.stopPropagation()}>
            {onDownload && (
              <button
                onClick={() => onDownload(asset)}
                disabled={loading || isUnavailable}
                aria-label={`Download ${asset.title}`}
                className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-medium px-2 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-40"
              >
                <Download className="w-3 h-3" />
                Download
              </button>
            )}
            {onArchiveToggle && (permission?.canArchive ?? true) && (
              <button
                onClick={() => onArchiveToggle(asset)}
                disabled={loading}
                aria-label={isArchived ? "Pulihkan" : "Arsipkan"}
                title={isArchived ? "Pulihkan dari arsip" : "Arsipkan asset"}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
              >
                {isArchived
                  ? <ArchiveRestore className="w-3.5 h-3.5" />
                  : <Archive className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
