// ============================================================
// TEAM 12 — Layout Composer Domain Limits
// Single source of truth for all resource caps.
// Import from here in BOTH routes and services — never
// define numeric limits inline.
// ============================================================

export const LAYOUT_LIMITS = {
  /** Maximum number of LayoutElements per request. */
  MAX_ELEMENTS: 500,

  /** Maximum number of Constraints per request. */
  MAX_CONSTRAINTS: 200,

  /** Maximum number of LayoutZones per request. */
  MAX_ZONES: 100,

  /** Maximum canvas dimension in either axis (px). */
  MAX_CANVAS_DIM: 10_000,

  /** Maximum solver iterations allowed (hard cap; user may request fewer). */
  MAX_ITERATIONS: 100,

  /** Maximum group nesting depth (children-of-children). */
  MAX_NESTING_DEPTH: 5,

  /** Wall-clock budget for a single solve() call (ms). */
  SOLVER_DEADLINE_MS: 5_000,

  /**
   * Maximum request body size accepted by the layout-composer router (bytes).
   * Enforced via Content-Length header pre-check. The global app.json limit
   * is 10 MB; we tighten this to 512 KB for the layout domain.
   */
  MAX_PAYLOAD_BYTES: 512 * 1024,
} as const;

export type LayoutLimitKey = keyof typeof LAYOUT_LIMITS;
