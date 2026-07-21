/**
 * AssetGrid.tsx — Grid layout for asset browser (Team 14)
 */

import { cn } from "@/lib/utils";
import { Loader2, FolderOpen } from "lucide-react";
import { AssetCard } from "./AssetCard";
import type { AssetSummary, AssetPermission, AssetSelection } from "./types";

interface AssetGridProps {
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

export function AssetGrid({
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
}: AssetGridProps) {
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
      aria-label="Asset grid"
      aria-multiselectable={selection.mode === "multi"}
      className={cn(
        "grid gap-4",
        "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6",
        className,
      )}
    >
      {items.map((asset) => (
        <AssetCard
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
