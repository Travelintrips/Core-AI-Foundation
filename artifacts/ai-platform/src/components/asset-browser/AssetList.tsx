/**
 * AssetList.tsx — List layout for asset browser (Team 14)
 */

import { cn } from "@/lib/utils";
import { Loader2, FolderOpen, Download, Archive, ArchiveRestore, CheckCircle2, Lock, AlertTriangle } from "lucide-react";
import { CategoryIcon, categoryBadgeClass, fmtFileSize } from "./AssetCard";
import type { AssetSummary, AssetPermission, AssetSelection } from "./types";

interface AssetListRowProps {
  asset: AssetSummary;
  permission?: AssetPermission;
  selected: boolean;
  /** "none" renders as browse-only (no checkbox, row role) */
  selectionMode: "single" | "multi" | "none";
  onSelect?: (a: AssetSummary) => void;
  onDownload?: (a: AssetSummary) => void;
  onArchiveToggle?: (a: AssetSummary) => void;
  onPreview?: (a: AssetSummary) => void;
}

function AssetListRow({
  asset,
  permission,
  selected,
  selectionMode,
  onSelect,
  onDownload,
  onArchiveToggle,
  onPreview,
}: AssetListRowProps) {
  const isArchived = asset.availability === "archived";
  const isUnavailable = asset.availability === "unavailable";
  const permDenied = permission && !permission.canView;

  if (permDenied) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50 opacity-50">
        <Lock className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="text-sm text-muted-foreground italic">Akses ditolak</span>
      </div>
    );
  }

  return (
    <div
      role={selectionMode !== "none" ? "option" : "row"}
      aria-selected={selectionMode !== "none" ? selected : undefined}
      aria-label={`Asset: ${asset.title}`}
      tabIndex={0}
      onClick={() => selectionMode !== "none" ? onSelect?.(asset) : onPreview?.(asset)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectionMode !== "none" ? onSelect?.(asset) : onPreview?.(asset);
        }
      }}
      className={cn(
        "flex items-center gap-3 px-4 py-3 border-b border-border/50 transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        selectionMode !== "none" ? "cursor-pointer" : "cursor-default",
        selected ? "bg-primary/5 border-l-2 border-l-primary" : "hover:bg-muted/30",
        (isArchived || isUnavailable) && "opacity-60",
      )}
    >
      {/* Selection checkbox */}
      {selectionMode !== "none" && (
        <div className={cn(
          "w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all",
          selected ? "bg-primary border-primary" : "border-muted-foreground/40",
        )}>
          {selected && <CheckCircle2 className="w-3.5 h-3.5 text-primary-foreground" />}
        </div>
      )}

      {/* Preview thumbnail */}
      <div className={cn(
        "w-10 h-10 rounded-lg shrink-0 flex items-center justify-center overflow-hidden",
        categoryBadgeClass(asset.category),
      )}>
        {asset.previewUrl ? (
          <img src={asset.previewUrl} alt={asset.title} className="w-full h-full object-cover rounded-lg" />
        ) : isUnavailable ? (
          <AlertTriangle className="w-4 h-4" />
        ) : (
          <CategoryIcon category={asset.category} className="w-4 h-4" />
        )}
      </div>

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{asset.title}</p>
        <p className="text-xs text-muted-foreground truncate">{asset.fileName}</p>
      </div>

      {/* Category badge */}
      <span className={cn(
        "hidden sm:inline-flex text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0",
        categoryBadgeClass(asset.category),
      )}>
        {asset.categoryLabel}
      </span>

      {/* Size */}
      {asset.fileSizeBytes !== null && (
        <span className="hidden md:block text-xs text-muted-foreground shrink-0 w-20 text-right">
          {fmtFileSize(asset.fileSizeBytes)}
        </span>
      )}

      {/* Archived badge */}
      {isArchived && (
        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">Arsip</span>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
        {onDownload && (permission?.canDownload ?? true) && (
          <button
            onClick={() => onDownload(asset)}
            disabled={isUnavailable}
            aria-label={`Download ${asset.title}`}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        )}
        {onArchiveToggle && (permission?.canArchive ?? true) && (
          <button
            onClick={() => onArchiveToggle(asset)}
            aria-label={isArchived ? "Pulihkan" : "Arsipkan"}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          >
            {isArchived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}

interface AssetListProps {
  items: AssetSummary[];
  loading?: boolean;
  selection: AssetSelection;
  onSelect: (asset: AssetSummary) => void;
  onDownload?: (asset: AssetSummary) => void;
  onArchiveToggle?: (asset: AssetSummary) => void;
  onPreview?: (asset: AssetSummary) => void;
  permissionFor?: (asset: AssetSummary) => AssetPermission;
  className?: string;
  emptyLabel?: string;
}

export function AssetList({
  items,
  loading,
  selection,
  onSelect,
  onDownload,
  onArchiveToggle,
  onPreview,
  permissionFor,
  className,
  emptyLabel = "Tidak ada asset ditemukan",
}: AssetListProps) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin" />
        <p className="text-sm">Memuat asset...</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
        <FolderOpen className="w-10 h-10 opacity-40" />
        <p className="text-sm">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div
      role="listbox"
      aria-label="Asset list"
      aria-multiselectable={selection.mode === "multi"}
      className={cn("border border-border rounded-xl overflow-hidden", className)}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 bg-muted/30 border-b border-border">
        <div className="w-5" />
        <div className="w-10" />
        <div className="flex-1 text-xs font-semibold text-muted-foreground">Nama</div>
        <div className="hidden sm:block text-xs font-semibold text-muted-foreground w-24">Kategori</div>
        <div className="hidden md:block text-xs font-semibold text-muted-foreground w-20 text-right">Ukuran</div>
        <div className="w-16" />
      </div>

      {items.map((asset) => (
        <AssetListRow
          key={asset.id}
          asset={asset}
          permission={permissionFor?.(asset)}
          selected={selection.selectedIds.has(asset.id)}
          selectionMode={selection.mode}
          onSelect={onSelect}
          onDownload={onDownload}
          onArchiveToggle={onArchiveToggle}
          onPreview={onPreview}
        />
      ))}
    </div>
  );
}
