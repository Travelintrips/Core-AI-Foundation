/**
 * AssetBrowserShell.tsx — Top-level container for the Universal Asset Browser (Team 14)
 *
 * Composes all sub-components: search, filters, grid/list toggle, pagination,
 * preview modal, upload entry point, and multi/single selection with confirm.
 */

import { useState, useCallback, useReducer } from "react";
import { LayoutGrid, List, Upload, ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { AssetSearch } from "./AssetSearch";
import { AssetFilters } from "./AssetFilters";
import { AssetGrid } from "./AssetGrid";
import { AssetList } from "./AssetList";
import { AssetPreview } from "./AssetPreview";
import { AssetUploadAdapter } from "./AssetUploadAdapter";
import { useAssetBrowser, useAssetArchiveMutation } from "./use-asset-browser";
import { AssetSourceRegistry } from "./AssetSourceRegistry";
import {
  DEFAULT_ASSET_FILTER,
  DEFAULT_ASSET_SORT,
} from "./types";
import type {
  AssetSummary,
  AssetFilter,
  AssetSort,
  AssetSelection,
  AssetPermission,
} from "./types";

// ── Selection reducer ─────────────────────────────────────────────────────────

type SelectionAction =
  | { type: "toggle"; id: number; mode: "single" | "multi" }
  | { type: "clear" };

function selectionReducer(state: AssetSelection, action: SelectionAction): AssetSelection {
  switch (action.type) {
    case "toggle": {
      if (action.mode === "single") {
        const next = new Set<number>();
        if (!state.selectedIds.has(action.id)) next.add(action.id);
        return { ...state, selectedIds: next };
      }
      const next = new Set(state.selectedIds);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return { ...state, selectedIds: next };
    }
    case "clear":
      return { ...state, selectedIds: new Set() };
    default:
      return state;
  }
}

// ── Default permission factory ────────────────────────────────────────────────

function defaultPermission(adminMode: boolean): AssetPermission {
  return {
    canView: true,
    canSelect: true,
    canDownload: true,
    canUpload: adminMode,
    canArchive: adminMode,
  };
}

// ── AssetBrowserShell ─────────────────────────────────────────────────────────

export interface AssetBrowserShellProps {
  /** "none" = browse-only, "single" = pick one, "multi" = pick many */
  selectionMode?: "none" | "single" | "multi";
  adminMode?: boolean;
  onConfirmSelection?: (assets: AssetSummary[]) => void;
  confirmLabel?: string;
  /** When true, suppresses internal top-level padding (used inside AssetPicker) */
  embedded?: boolean;
  className?: string;
  pageSize?: number;
}

export function AssetBrowserShell({
  selectionMode = "none",
  adminMode = false,
  onConfirmSelection,
  confirmLabel = "Pilih",
  embedded = false,
  className,
  pageSize = 24,
}: AssetBrowserShellProps) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [filter, setFilter] = useState<AssetFilter>(DEFAULT_ASSET_FILTER);
  const [sort, setSort] = useState<AssetSort>(DEFAULT_ASSET_SORT);
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [previewAsset, setPreviewAsset] = useState<AssetSummary | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  const [selection, dispatchSelection] = useReducer(selectionReducer, {
    mode: selectionMode === "none" ? "single" : selectionMode,
    selectedIds: new Set<number>(),
  });

  // ── Data ───────────────────────────────────────────────────────────────────
  const { data, isLoading, isError, error } = useAssetBrowser({
    filter,
    sort,
    page,
    pageSize,
  });

  const archiveMutation = useAssetArchiveMutation();

  // ── Callbacks ──────────────────────────────────────────────────────────────
  const patchFilter = useCallback((patch: Partial<AssetFilter>) => {
    setFilter((prev) => ({ ...prev, ...patch }));
    setPage(1);
  }, []);

  const handleSelect = useCallback((asset: AssetSummary) => {
    if (selectionMode === "none") return;
    dispatchSelection({ type: "toggle", id: asset.id, mode: selectionMode });
  }, [selectionMode]);

  const handleDownload = useCallback(async (asset: AssetSummary) => {
    if (!asset.previewUrl) return;
    const a = document.createElement("a");
    a.href = asset.previewUrl;
    a.download = asset.fileName;
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  const handleArchiveToggle = useCallback((asset: AssetSummary) => {
    const archive = asset.availability !== "archived";
    archiveMutation.mutate({ id: asset.id, archive });
  }, [archiveMutation]);

  const handleConfirm = useCallback(() => {
    if (!data || !onConfirmSelection) return;
    const selected = data.items.filter((a) => selection.selectedIds.has(a.id));
    onConfirmSelection(selected);
    dispatchSelection({ type: "clear" });
  }, [data, selection.selectedIds, onConfirmSelection]);

  const permissionFor = useCallback(
    (_asset: AssetSummary): AssetPermission => defaultPermission(adminMode),
    [adminMode],
  );

  // ── Computed ───────────────────────────────────────────────────────────────
  const sources = AssetSourceRegistry.list({ adminMode });
  const totalPages = data ? Math.ceil(data.total / pageSize) : 1;
  const selectedCount = selection.selectedIds.size;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={cn("flex flex-col h-full", !embedded && "p-4 gap-4", embedded && "gap-3", className)}>
      {/* Toolbar */}
      <div className={cn("flex flex-wrap items-center gap-2", embedded && "px-4 pt-4")}>
        <AssetSearch
          value={filter.search}
          onChange={(v) => patchFilter({ search: v })}
          className="flex-1 min-w-48"
        />

        {/* View toggle */}
        <div className="flex items-center border border-border rounded-lg overflow-hidden shrink-0">
          <button
            onClick={() => setViewMode("grid")}
            aria-label="Grid view"
            aria-pressed={viewMode === "grid"}
            className={cn(
              "p-2 transition-colors",
              viewMode === "grid" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
            )}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode("list")}
            aria-label="List view"
            aria-pressed={viewMode === "list"}
            className={cn(
              "p-2 transition-colors",
              viewMode === "list" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
            )}
          >
            <List className="w-4 h-4" />
          </button>
        </div>

        {/* Upload button */}
        {(adminMode || true) && (
          <button
            onClick={() => setShowUpload((v) => !v)}
            aria-expanded={showUpload}
            aria-label={showUpload ? "Tutup upload" : "Upload asset"}
            className={cn(
              "flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border transition-colors shrink-0",
              showUpload
                ? "bg-primary/10 border-primary/30 text-primary"
                : "border-border hover:bg-muted text-muted-foreground",
            )}
          >
            <Upload className="w-3.5 h-3.5" />
            Upload
          </button>
        )}
      </div>

      {/* Filters */}
      <div className={cn(embedded && "px-4")}>
        <AssetFilters
          filter={filter}
          sort={sort}
          onFilterChange={patchFilter}
          onSortChange={(s) => { setSort(s); setPage(1); }}
          adminMode={adminMode}
        />
      </div>

      {/* Upload panel */}
      {showUpload && (
        <div className={cn("border border-border rounded-xl bg-muted/20", embedded ? "mx-4 p-4" : "p-4")}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium">Upload Asset Baru</p>
            <button
              onClick={() => setShowUpload(false)}
              aria-label="Tutup upload panel"
              className="p-1 rounded text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <AssetUploadAdapter
            multiple
            onComplete={() => {
              // After upload, re-trigger query by bumping page (force refetch pattern)
              setPage((p) => p);
            }}
          />
        </div>
      )}

      {/* Error state */}
      {isError && (
        <div className={cn("flex items-center gap-2 text-destructive text-sm p-4 bg-destructive/5 rounded-xl border border-destructive/20", embedded && "mx-4")}>
          <span>Gagal memuat asset: {(error as Error)?.message ?? "Kesalahan tidak diketahui"}</span>
        </div>
      )}

      {/* Asset grid / list */}
      <div className={cn("flex-1 overflow-y-auto min-h-0", embedded && "px-4")}>
        {/* Sources hint — only show if no filter active */}
        {sources.length > 1 && !filter.sourceId && !filter.search && page === 1 && (
          <p className="text-xs text-muted-foreground mb-3">
            {sources.length} sumber aktif · pilih sumber di filter untuk mempersempit hasil
          </p>
        )}

        {viewMode === "grid" ? (
          <AssetGrid
            items={data?.items ?? []}
            loading={isLoading}
            selection={selectionMode === "none"
              ? { mode: "single", selectedIds: new Set() }
              : selection}
            onSelect={handleSelect}
            onDownload={handleDownload}
            onArchiveToggle={adminMode ? handleArchiveToggle : undefined}
            onPreview={setPreviewAsset}
            permissionFor={permissionFor}
          />
        ) : (
          <AssetList
            items={data?.items ?? []}
            loading={isLoading}
            selection={selectionMode === "none"
              ? { mode: "single", selectedIds: new Set() }
              : selection}
            onSelect={handleSelect}
            onDownload={handleDownload}
            onArchiveToggle={adminMode ? handleArchiveToggle : undefined}
            onPreview={setPreviewAsset}
            permissionFor={permissionFor}
          />
        )}
      </div>

      {/* Pagination + selection confirm */}
      {(totalPages > 1 || selectedCount > 0) && (
        <div className={cn(
          "flex items-center justify-between border-t border-border pt-3 shrink-0",
          embedded && "px-4 pb-4",
        )}>
          {/* Pagination */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isLoading}
              aria-label="Halaman sebelumnya"
              className="p-1.5 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs text-muted-foreground">
              {page} / {totalPages} · {data?.total ?? 0} asset
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || isLoading}
              aria-label="Halaman berikutnya"
              className="p-1.5 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Selection confirm */}
          {selectionMode !== "none" && selectedCount > 0 && onConfirmSelection && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {selectedCount} dipilih
              </span>
              <button
                onClick={() => dispatchSelection({ type: "clear" })}
                aria-label="Hapus seleksi"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-3.5 h-3.5 inline mr-0.5" />
                Reset
              </button>
              <button
                onClick={handleConfirm}
                className="text-xs font-medium px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                {confirmLabel} ({selectedCount})
              </button>
            </div>
          )}
        </div>
      )}

      {/* Asset preview modal */}
      {previewAsset && (
        <AssetPreview
          asset={previewAsset}
          permission={permissionFor(previewAsset)}
          onClose={() => setPreviewAsset(null)}
          onDownload={handleDownload}
          onArchiveToggle={adminMode ? handleArchiveToggle : undefined}
        />
      )}
    </div>
  );
}
