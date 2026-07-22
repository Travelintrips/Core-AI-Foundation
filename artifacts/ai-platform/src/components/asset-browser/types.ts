/**
 * types.ts — Universal Asset Browser contract types (Team 14)
 *
 * All contracts are additive and adapter-friendly — canonical artifact
 * contracts are NOT duplicated here; adapters bridge them when needed.
 */

// ── Asset type ────────────────────────────────────────────────────────────────

export type AssetType =
  | "image"
  | "document"
  | "pdf"
  | "video_preview"
  | "font_reference"
  | "material_preview"
  | "icon"
  | "logo"
  | "reference"
  | "generated_artifact"
  | "external_approved"
  | "unknown";

// ── Asset source ──────────────────────────────────────────────────────────────

export type AssetSourceId =
  | "project_assets"
  | "brand_library"
  | "generated_artifacts"
  | "uploaded_references"
  | "shared_approved"
  | string; // plugin-contributed sources via registry

// ── Availability & permissions ────────────────────────────────────────────────

export type AssetAvailability = "available" | "archived" | "unavailable";

export interface AssetPermission {
  canView: boolean;
  canSelect: boolean;
  canDownload: boolean;
  canUpload: boolean;
  canArchive: boolean;
}

// ── Core asset shapes ─────────────────────────────────────────────────────────

/**
 * AssetSummary — full asset record for display in grid/list.
 */
export interface AssetSummary {
  id: number;
  title: string;
  fileName: string;
  assetType: AssetType;
  /** Raw category string from DB (e.g. "logo", "generated_image") */
  category: string;
  categoryLabel: string;
  sourceId: AssetSourceId;
  availability: AssetAvailability;
  previewUrl: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  version: number;
  tags: string[];
  uploadedBy: string | null;
  /** Tenant owner identifier — emailHash for customer assets */
  tenantKey: string;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Set when the asset has a pending signed-URL that has expired */
  previewExpired?: boolean;
}

/**
 * AssetReference — lightweight pointer used to link an asset to another entity.
 */
export interface AssetReference {
  assetId: number;
  assetType: AssetType;
  title: string;
  previewUrl: string | null;
  sourceId: AssetSourceId;
}

/**
 * AssetPreviewDescriptor — how to render a preview for a given asset.
 */
export interface AssetPreviewDescriptor {
  kind: "image" | "pdf" | "video" | "icon_placeholder" | "unavailable";
  url: string | null;
  /** mime type for <video> source selection */
  mimeType?: string;
  altText: string;
}

// ── Filter / sort / selection ─────────────────────────────────────────────────

export interface AssetFilter {
  search: string;
  assetType: AssetType | "";
  sourceId: AssetSourceId | "";
  category: string;
  tags: string[];
  showArchived: boolean;
  favoritedOnly: boolean;
  projectId: string;
}

export const DEFAULT_ASSET_FILTER: AssetFilter = {
  search: "",
  assetType: "",
  sourceId: "",
  category: "",
  tags: [],
  showArchived: false,
  favoritedOnly: false,
  projectId: "",
};

export type AssetSortField = "newest" | "oldest" | "name" | "size";

export interface AssetSort {
  field: AssetSortField;
}

export const DEFAULT_ASSET_SORT: AssetSort = { field: "newest" };

export interface AssetSelection {
  mode: "single" | "multi";
  selectedIds: Set<number>;
}

// ── Pagination ────────────────────────────────────────────────────────────────

export interface AssetPage {
  items: AssetSummary[];
  total: number;
  page: number;
  pageSize: number;
}

// ── Upload ────────────────────────────────────────────────────────────────────

export type UploadStatus = "idle" | "requesting" | "uploading" | "complete" | "error" | "cancelled";

export interface UploadEntry {
  id: string;
  file: File;
  status: UploadStatus;
  progress: number;
  error: string | null;
  /** Object URL created for preview — must be revoked when done */
  objectUrl: string | null;
  /** Result after successful upload */
  storagePath: string | null;
  previewUrl: string | null;
}

// ── Validation ────────────────────────────────────────────────────────────────

export interface UploadValidationResult {
  valid: boolean;
  error: string | null;
}

export const ALLOWED_MIME_TYPES: readonly string[] = [
  // Images
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml", // sanitized — no arbitrary SVG rendered as HTML
  // Documents
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  // Video preview (short clips only)
  "video/mp4",
  "video/webm",
  // Fonts
  "font/ttf",
  "font/otf",
  "font/woff",
  "font/woff2",
  "application/octet-stream", // fallback for font files
];

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

export function deriveAssetType(mimeType: string | null | undefined): AssetType {
  if (!mimeType) return "unknown";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("video/")) return "video_preview";
  if (mimeType.startsWith("font/") || mimeType.includes("font")) return "font_reference";
  if (mimeType.startsWith("text/") || mimeType.includes("document") || mimeType.includes("spreadsheet") || mimeType.includes("presentation")) return "document";
  return "unknown";
}

export function validateUploadFile(file: File): UploadValidationResult {
  // Size
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { valid: false, error: `File terlalu besar (maks 50 MB). Ukuran: ${(file.size / 1024 / 1024).toFixed(1)} MB` };
  }
  // MIME
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED_MIME_TYPES.includes(mime)) {
    return { valid: false, error: `Format tidak didukung: ${mime || "(unknown)"}` };
  }
  // Extension sanity
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const blockedExtensions = ["exe", "sh", "bat", "cmd", "msi", "dmg", "ps1", "vbs", "js", "html", "php"];
  if (blockedExtensions.includes(ext)) {
    return { valid: false, error: `Ekstensi file tidak diizinkan: .${ext}` };
  }
  // Filename safety
  if (/[<>"'\\]/.test(file.name)) {
    return { valid: false, error: "Nama file mengandung karakter tidak aman" };
  }
  return { valid: true, error: null };
}

// ── Source registry types (for plugin contract) ───────────────────────────────

export interface AssetSourceRegistration {
  id: AssetSourceId;
  label: string;
  description?: string;
  /** Whether admin API key is required */
  requiresAdmin: boolean;
  /** Additional filter metadata contributed by this source */
  filterMetadata?: Record<string, string[]>;
}
