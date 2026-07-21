/**
 * index.ts — Public exports for the Universal Asset Browser (Team 14)
 *
 * Integration notes:
 * - Team 11: use <AssetPicker> to attach assets to workspace artifacts
 * - Team 12: use <AssetPicker> from reference fields (mode="single")
 * - Team 17: register export sources via AssetSourceRegistry.register()
 * - Team 24+ plugins: register domain sources via AssetSourceRegistry.register()
 */

// ── Types (contract) ──────────────────────────────────────────────────────────
export type {
  AssetType,
  AssetSourceId,
  AssetAvailability,
  AssetPermission,
  AssetSummary,
  AssetReference,
  AssetPreviewDescriptor,
  AssetFilter,
  AssetSort,
  AssetSortField,
  AssetSelection,
  AssetPage,
  UploadEntry,
  UploadStatus,
  UploadValidationResult,
  AssetSourceRegistration,
} from "./types";

export {
  DEFAULT_ASSET_FILTER,
  DEFAULT_ASSET_SORT,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  validateUploadFile,
  deriveAssetType,
} from "./types";

// ── Source Registry ───────────────────────────────────────────────────────────
export { AssetSourceRegistry } from "./AssetSourceRegistry";

// ── Hooks ─────────────────────────────────────────────────────────────────────
export {
  useAssetBrowser,
  useAssetDetail,
  useAssetBrowserSources,
  useAssetArchiveMutation,
  useRequestUploadUrl,
  assetBrowserKeys,
} from "./use-asset-browser";

// ── Components ────────────────────────────────────────────────────────────────
export { AssetBrowserShell } from "./AssetBrowserShell";
export { AssetPicker } from "./AssetPicker";
export { AssetGrid } from "./AssetGrid";
export { AssetList } from "./AssetList";
export { AssetCard, CategoryIcon, categoryBadgeClass, fmtFileSize } from "./AssetCard";
export { AssetPreview, resolvePreviewDescriptor } from "./AssetPreview";
export { AssetFilters } from "./AssetFilters";
export { AssetSearch } from "./AssetSearch";
export { AssetUploadAdapter } from "./AssetUploadAdapter";
export type { UploadResult } from "./AssetUploadAdapter";
export type { AssetPickerProps } from "./AssetPicker";
export type { AssetBrowserShellProps } from "./AssetBrowserShell";
