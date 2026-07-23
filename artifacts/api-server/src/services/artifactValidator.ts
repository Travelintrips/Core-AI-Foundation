/**
 * artifactValidator.ts — Team 44: Canonical artifact validation service.
 *
 * Validates that a creative_ai_assets row represents a real, storage-backed,
 * tenant-scoped artifact before it can be used as a final deliverable.
 *
 * Rules (Phase 5):
 *  - Artifact ID valid (positive integer)
 *  - Project relation exists
 *  - Asset type known
 *  - MIME type plausible for type (if provided)
 *  - Storage reference non-null, non-placeholder, non-demo
 *  - Status is NOT a failure state
 *  - renderStage is NOT a preview-only stage for final promotion
 *  - Content NOT zero-byte (checked via metadata.fileSizeBytes if present)
 *  - Not from failed/cancelled job (status guard)
 *
 * This does NOT perform live network calls — for storage existence checks
 * use storageObjectExists() from supabaseStorage separately.
 */

import type { CreativeAiAsset } from "@workspace/db";

// ── Constants ─────────────────────────────────────────────────────────────────

const KNOWN_ASSET_TYPES = new Set([
  "image", "document", "presentation", "logo", "icon",
  "brand_guideline", "illustration", "source_file", "company_profile",
  "social_media", "packaging", "pitch_deck", "typography", "color_palette",
  "marketing", "video_thumbnail", "banner",
]);

const FAILURE_STATUSES = new Set([
  "failed", "rejected", "error", "cancelled", "revoked",
]);

const PLACEHOLDER_PATTERNS = [
  /^https?:\/\/placeholder/i,
  /^https?:\/\/via\.placeholder/i,
  /^https?:\/\/picsum/i,
  /^https?:\/\/loremflickr/i,
  /\/demo\//i,
  /\/static\/demo/i,
  /\/sample\//i,
  /^data:image\/svg\+xml/i,   // inline SVG placeholder
];

const PLACEHOLDER_PATHS = [
  "/placeholder",
  "/demo/",
  "/static/demo",
  "/sample/",
  "/test/",
];

/** MIME types expected for each asset type (partial — not exhaustive). */
const MIME_EXPECTATIONS: Record<string, RegExp> = {
  document:      /^application\/(pdf|msword|vnd\.|octet-stream)/,
  presentation:  /^application\/(vnd\.openxmlformats|vnd\.ms-powerpoint|pdf)/,
  image:         /^image\//,
  logo:          /^image\//,
  icon:          /^image\//,
  illustration:  /^image\//,
};

// ── Result type ──────────────────────────────────────────────────────────────

export interface ArtifactValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ── Core validator ────────────────────────────────────────────────────────────

/**
 * Validate an artifact record without network calls.
 * @param asset  Row from creative_ai_assets.
 * @param opts   Options (isFinalPromotion = true applies stricter rules).
 */
export function validateArtifactRecord(
  asset: CreativeAiAsset,
  opts: { isFinalPromotion?: boolean } = {},
): ArtifactValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { isFinalPromotion = false } = opts;

  // 1. ID valid
  if (!asset.id || asset.id <= 0) {
    errors.push(`Artifact id is invalid: ${asset.id}`);
  }

  // 2. Project relation
  if (!asset.projectId || asset.projectId.trim() === "") {
    errors.push("Artifact has no projectId — cannot associate with project");
  }

  // 3. Asset type known
  if (!asset.assetType || !KNOWN_ASSET_TYPES.has(asset.assetType)) {
    warnings.push(`Asset type "${asset.assetType}" is unknown or unregistered`);
  }

  // 4. Status not a failure state
  if (asset.status && FAILURE_STATUSES.has(asset.status)) {
    errors.push(`Artifact status "${asset.status}" is a terminal failure — cannot be used as final output`);
  }

  // 5. Storage reference
  const storageRef = asset.storagePath ?? asset.imageUrl;

  if (!storageRef || storageRef.trim() === "") {
    errors.push("Artifact has no storage reference (storagePath and imageUrl are both null/empty)");
  } else {
    // 5a. Placeholder check
    const isPlaceholder = PLACEHOLDER_PATTERNS.some((rx) => rx.test(storageRef))
      || PLACEHOLDER_PATHS.some((p) => storageRef.includes(p));
    if (isPlaceholder) {
      errors.push(`Artifact storage reference appears to be a placeholder/demo: "${storageRef.slice(0, 80)}"`);
    }

    // 5b. For final promotion: storagePath (not just imageUrl) must be set
    if (isFinalPromotion && !asset.storagePath) {
      errors.push("Final artifact promotion requires storagePath to be set — imageUrl alone is insufficient");
    }
  }

  // 6. renderStage check for final promotion
  if (isFinalPromotion) {
    if (asset.renderStage === "preview") {
      errors.push("Preview-stage artifact cannot be promoted as a final deliverable artifact");
    }
  }

  // 7. MIME type plausibility (if available via metadata)
  const meta = asset.metadata as Record<string, unknown> | null;
  if (meta) {
    const mimeType = typeof meta["mimeType"] === "string" ? meta["mimeType"] : null;
    if (mimeType && asset.assetType && MIME_EXPECTATIONS[asset.assetType]) {
      if (!MIME_EXPECTATIONS[asset.assetType]!.test(mimeType)) {
        warnings.push(`MIME type "${mimeType}" unexpected for asset type "${asset.assetType}"`);
      }
    }

    // 8. Zero-byte check
    const size = typeof meta["fileSizeBytes"] === "number" ? meta["fileSizeBytes"] : null;
    if (size !== null && size <= 0) {
      errors.push(`Artifact has zero or negative file size (${size} bytes) — file may be corrupt or empty`);
    }

    // 9. noText/overlay failure flag
    const noTextFailure = meta["noTextOverlayFailed"] === true || meta["overlayFailed"] === true;
    if (isFinalPromotion && noTextFailure) {
      errors.push("Artifact has noText/overlay failure flag — cannot be promoted as final artifact");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Check whether a storage path string is a known placeholder/demo value.
 */
export function isPlaceholderStorageRef(ref: string | null | undefined): boolean {
  if (!ref || ref.trim() === "") return true;
  return PLACEHOLDER_PATTERNS.some((rx) => rx.test(ref))
    || PLACEHOLDER_PATHS.some((p) => ref.includes(p));
}

/**
 * Check whether an asset status indicates a failure terminal state.
 */
export function isFailureStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return FAILURE_STATUSES.has(status);
}
