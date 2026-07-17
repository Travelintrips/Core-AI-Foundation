/**
 * resourceLimits.ts — Team 14
 *
 * Single authoritative source for all numeric resource limits.
 * No magic numbers scattered across the codebase.
 */

export const UNIVERSAL_RENDER_LIMITS = {
  /** Maximum HTTP request body size in bytes (10 MB) */
  MAX_PAYLOAD_BYTES: 10 * 1024 * 1024,

  /** Maximum SVG input string size in bytes (5 MB) */
  MAX_SVG_BYTES: 5 * 1024 * 1024,

  /** Maximum canvas width in pixels */
  MAX_CANVAS_WIDTH: 8_192,

  /** Maximum canvas height in pixels */
  MAX_CANVAS_HEIGHT: 8_192,

  /** Maximum total pixel count (prevents memory exhaustion) */
  MAX_CANVAS_PIXELS: 8_192 * 8_192,

  /** Maximum number of distinct external asset URLs in a single SVG */
  MAX_ASSET_COUNT: 50,

  /** Maximum bytes per external asset (image / font) */
  MAX_ASSET_BYTES: 10 * 1024 * 1024,

  /** Maximum total embedded asset bytes across all assets in one render */
  MAX_TOTAL_ASSET_BYTES: 50 * 1024 * 1024,

  /** Maximum raster (PNG/JPG/WebP) output size in bytes (30 MB) */
  MAX_PNG_BYTES: 30 * 1024 * 1024,

  /** Maximum PDF output size in bytes (50 MB) */
  MAX_PDF_BYTES: 50 * 1024 * 1024,

  /** Maximum ZIP package size in bytes (200 MB) */
  MAX_ZIP_BYTES: 200 * 1024 * 1024,

  /** Maximum wall-clock render duration before RENDER_TIMEOUT (ms) */
  MAX_RENDER_DURATION_MS: 60_000,

  /** Per-fetch timeout for external asset retrieval (ms) */
  ASSET_FETCH_TIMEOUT_MS: 10_000,

  /** Maximum redirects allowed when fetching an external URL */
  MAX_REDIRECTS: 3,

  /** Idempotency in-memory cache TTL (ms) */
  IDEMPOTENCY_TTL_MS: 5 * 60 * 1_000,

  /** Maximum idempotency cache entries before oldest eviction */
  IDEMPOTENCY_MAX_ENTRIES: 1_000,
} as const;
