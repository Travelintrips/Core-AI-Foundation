/**
 * validators.ts — Team 19: Packaging Design — dimension & dieline bounds validation
 *
 * PURE module: no DB calls, no side effects. Safe to call from routes, service,
 * and tests without any mocking.
 *
 * BOUNDS enforced at order-creation time (before any prepress check):
 *   - Negative values       → rejected immediately (400)
 *   - Zero width/height     → rejected (depth=0 is OK for flat packaging)
 *   - Exceeds physical max  → rejected
 *   - Bleed ≥ panel half    → rejected (no printable area remains)
 *   - Safe area overflows   → rejected (exceeds printable area after bleed)
 *   - Malformed dieline     → rejected (unknown/duplicate panel names)
 *   - Invalid resolution    → rejected
 *   - Excess panel count    → rejected
 */

// ─────────────────────────────────────────────────────────────────────────────
// Bounds constants
// ─────────────────────────────────────────────────────────────────────────────

export const PACKAGING_BOUNDS = {
  /** Minimum printable dimension for any side (mm). Smaller than this is unusable. */
  DIMENSION_MIN_MM: 10,
  /** Maximum practical dimension for any side (mm). Larger than this is not feasible. */
  DIMENSION_MAX_MM: 3000,
  /** Maximum depth for 3-D packaging (mm). 0 is valid for flat label/sleeve. */
  DEPTH_MAX_MM: 2000,
  /** Minimum bleed (mm). 0 = accepted at creation; prepress will flag < 3mm separately. */
  BLEED_MIN_MM: 0,
  /** Maximum bleed (mm). 25mm is the practical upper limit for any packaging format. */
  BLEED_MAX_MM: 25,
  /** Maximum safe-area inset from the printable edge (mm). */
  SAFE_AREA_MAX_MM: 50,
  /** Minimum artwork resolution (dpi). 72 = screen preview. */
  RESOLUTION_MIN_DPI: 72,
  /** Maximum artwork resolution (dpi). Beyond 1200 is unnecessary overhead. */
  RESOLUTION_MAX_DPI: 1200,
  /** Minimum recommended print resolution. Orders below this receive a warning. */
  RESOLUTION_PRINT_MIN_DPI: 300,
  /** Maximum number of distinct dieline panels. */
  PANEL_COUNT_MAX: 12,
} as const;

export const VALID_PANEL_NAMES = ["front", "back", "side", "top", "bottom"] as const;
export type ValidPanelName = (typeof VALID_PANEL_NAMES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidationError {
  field: string;
  code:  string;
  message: string;
}

export interface DimensionValidationResult {
  valid:    boolean;
  errors:   ValidationError[];
  warnings: string[];
}

export interface DimensionInput {
  widthMm?:        string | number | null;
  heightMm?:       string | number | null;
  depthMm?:        string | number | null;
  bleedMm?:        string | number | null;
  safeAreaMm?:     string | number | null;
  resolutionDpi?:  number | null;
  panelsRequired?: string[];
  serviceType?:    string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Parse a numeric field. Returns null on empty/missing; pushes an error on NaN. */
function parseField(
  v: string | number | null | undefined,
  field: string,
  errors: ValidationError[],
): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (isNaN(n)) {
    errors.push({ field, code: "INVALID_NUMBER", message: `${field} must be a valid number, got: "${v}"` });
    return null;
  }
  return n;
}

/** Helper: push a single error. */
function err(
  errors: ValidationError[],
  field: string,
  code: string,
  message: string,
): void {
  errors.push({ field, code, message });
}

// ─────────────────────────────────────────────────────────────────────────────
// Core validator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * validateDimensions
 *
 * Validates all dimension, bleed, safe-area, resolution, and panel fields for a
 * packaging design order.  Returns { valid, errors, warnings }.
 *
 * Runs BEFORE any database write.  Calling code should return HTTP 400 if
 * `valid === false`.
 */
export function validateDimensions(input: DimensionInput): DimensionValidationResult {
  const errors: ValidationError[]  = [];
  const warnings: string[]          = [];
  const B = PACKAGING_BOUNDS;

  // ── Parse raw values ───────────────────────────────────────────────────────
  const width     = parseField(input.widthMm,    "widthMm",    errors);
  const height    = parseField(input.heightMm,   "heightMm",   errors);
  const depth     = parseField(input.depthMm,    "depthMm",    errors);
  const bleedRaw  = parseField(input.bleedMm,    "bleedMm",    errors);
  const safeRaw   = parseField(input.safeAreaMm, "safeAreaMm", errors);
  const bleed     = bleedRaw  ?? 3;  // default 3mm if not provided
  const safe      = safeRaw   ?? 5;  // default 5mm if not provided

  // Stop immediately if any field is non-numeric — nothing else can be computed.
  if (errors.length > 0) return { valid: false, errors, warnings };

  // ── 1. Negative values (hard reject) ──────────────────────────────────────
  if (width  !== null && width  < 0) err(errors, "widthMm",    "NEGATIVE_VALUE", "Width cannot be negative.");
  if (height !== null && height < 0) err(errors, "heightMm",   "NEGATIVE_VALUE", "Height cannot be negative.");
  if (depth  !== null && depth  < 0) err(errors, "depthMm",    "NEGATIVE_VALUE", "Depth cannot be negative.");
  if (bleed < 0)                      err(errors, "bleedMm",    "NEGATIVE_VALUE", "Bleed cannot be negative.");
  if (safe  < 0)                      err(errors, "safeAreaMm", "NEGATIVE_VALUE", "Safe area cannot be negative.");

  // ── 2. Zero dimensions (hard reject for principal dimensions) ─────────────
  // Depth = 0 is valid (flat label/sleeve). Width and height must be > 0 if provided.
  if (width  !== null && width  === 0) err(errors, "widthMm",  "ZERO_DIMENSION", "Width cannot be zero.");
  if (height !== null && height === 0) err(errors, "heightMm", "ZERO_DIMENSION", "Height cannot be zero.");

  // ── 3. Unrealistically large dimensions ───────────────────────────────────
  if (width  !== null && width  > B.DIMENSION_MAX_MM)
    err(errors, "widthMm",  "EXCEEDS_MAX", `Width ${width}mm exceeds the maximum of ${B.DIMENSION_MAX_MM}mm.`);
  if (height !== null && height > B.DIMENSION_MAX_MM)
    err(errors, "heightMm", "EXCEEDS_MAX", `Height ${height}mm exceeds the maximum of ${B.DIMENSION_MAX_MM}mm.`);
  if (depth  !== null && depth  > B.DEPTH_MAX_MM)
    err(errors, "depthMm",  "EXCEEDS_MAX", `Depth ${depth}mm exceeds the maximum of ${B.DEPTH_MAX_MM}mm.`);

  // ── 4. Minimum printable dimension ────────────────────────────────────────
  if (width  !== null && width  > 0 && width  < B.DIMENSION_MIN_MM)
    err(errors, "widthMm",  "BELOW_MIN", `Width ${width}mm is below the minimum printable size of ${B.DIMENSION_MIN_MM}mm.`);
  if (height !== null && height > 0 && height < B.DIMENSION_MIN_MM)
    err(errors, "heightMm", "BELOW_MIN", `Height ${height}mm is below the minimum printable size of ${B.DIMENSION_MIN_MM}mm.`);

  // ── 5. Bleed bounds ───────────────────────────────────────────────────────
  if (bleed > B.BLEED_MAX_MM)
    err(errors, "bleedMm", "EXCEEDS_MAX", `Bleed ${bleed}mm exceeds the maximum of ${B.BLEED_MAX_MM}mm.`);

  // ── 6. Bleed larger than half a panel (no printable area remains) ─────────
  if (width !== null && width > 0 && bleed >= width / 2) {
    err(errors, "bleedMm", "BLEED_EXCEEDS_PANEL",
      `Bleed ${bleed}mm ≥ half of width ${width}mm. No printable area remains on the width axis.`);
  }
  if (height !== null && height > 0 && bleed >= height / 2) {
    err(errors, "bleedMm", "BLEED_EXCEEDS_PANEL",
      `Bleed ${bleed}mm ≥ half of height ${height}mm. No printable area remains on the height axis.`);
  }

  // ── 7. Safe area exceeds printable area ───────────────────────────────────
  if (safe > B.SAFE_AREA_MAX_MM)
    err(errors, "safeAreaMm", "EXCEEDS_MAX", `Safe area ${safe}mm exceeds the maximum of ${B.SAFE_AREA_MAX_MM}mm.`);

  if (width !== null && width > 0) {
    const printableW = width - 2 * bleed;
    if (printableW <= 0) {
      err(errors, "bleedMm", "NO_PRINTABLE_AREA",
        `Bleed (${bleed}mm × 2) consumes the entire width (${width}mm). Increase width or reduce bleed.`);
    } else if (safe * 2 >= printableW) {
      err(errors, "safeAreaMm", "SAFE_AREA_EXCEEDS_PRINTABLE",
        `Safe area (${safe}mm × 2 = ${safe * 2}mm) meets or exceeds the printable width (${printableW}mm). Reduce safe area or increase width.`);
    }
  }
  if (height !== null && height > 0) {
    const printableH = height - 2 * bleed;
    if (printableH > 0 && safe * 2 >= printableH) {
      err(errors, "safeAreaMm", "SAFE_AREA_EXCEEDS_PRINTABLE",
        `Safe area (${safe}mm × 2 = ${safe * 2}mm) meets or exceeds the printable height (${printableH}mm). Reduce safe area or increase height.`);
    }
  }

  // ── 8. Resolution bounds ──────────────────────────────────────────────────
  if (input.resolutionDpi !== null && input.resolutionDpi !== undefined) {
    const dpi = input.resolutionDpi;
    if (dpi < 0)
      err(errors, "resolutionDpi", "NEGATIVE_VALUE", "Resolution cannot be negative.");
    else if (dpi === 0)
      err(errors, "resolutionDpi", "ZERO_DIMENSION", "Resolution cannot be zero.");
    else if (dpi < B.RESOLUTION_MIN_DPI)
      err(errors, "resolutionDpi", "BELOW_MIN",
        `Resolution ${dpi} dpi is below the minimum of ${B.RESOLUTION_MIN_DPI} dpi (screen preview).`);
    else if (dpi > B.RESOLUTION_MAX_DPI)
      err(errors, "resolutionDpi", "EXCEEDS_MAX",
        `Resolution ${dpi} dpi exceeds the maximum of ${B.RESOLUTION_MAX_DPI} dpi.`);
    else if (dpi < B.RESOLUTION_PRINT_MIN_DPI)
      warnings.push(`Resolution ${dpi} dpi is below the recommended ${B.RESOLUTION_PRINT_MIN_DPI} dpi for commercial printing. Files may appear pixelated when printed.`);
  }

  // ── 9. Panel count & malformed dieline ────────────────────────────────────
  const panels = input.panelsRequired ?? [];

  if (panels.length > B.PANEL_COUNT_MAX)
    err(errors, "panelsRequired", "PANEL_COUNT_EXCEEDED",
      `Panel count (${panels.length}) exceeds the maximum of ${B.PANEL_COUNT_MAX}.`);

  const unknownPanels = panels.filter(
    (p) => !(VALID_PANEL_NAMES as readonly string[]).includes(p),
  );
  if (unknownPanels.length > 0)
    err(errors, "panelsRequired", "MALFORMED_DIELINE",
      `Unknown panel name(s): ${unknownPanels.map((p) => `"${p}"`).join(", ")}. ` +
      `Valid values: ${VALID_PANEL_NAMES.join(", ")}.`);

  const seen = new Set<string>();
  const duplicates = panels.filter((p) => { const d = seen.has(p); seen.add(p); return d; });
  if (duplicates.length > 0)
    err(errors, "panelsRequired", "MALFORMED_DIELINE",
      `Duplicate panel entries: ${[...new Set(duplicates)].map((p) => `"${p}"`).join(", ")}.`);

  return { valid: errors.length === 0, errors, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Print-ready disclaimer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PRINT_READY_DISCLAIMER
 *
 * MUST be included in any API response that returns order data before the order
 * has passed prepress/technical validation.  Prevents customers from sending
 * unvalidated artwork to press.
 */
export const PRINT_READY_DISCLAIMER =
  "⚠ PERHATIAN: Pesanan ini BELUM berstatus print-ready. " +
  "Prepress/technical validation wajib dilakukan oleh tim desainer sebelum file dapat dikirim ke percetakan. " +
  "Dimensi, bleed, safe area, mode warna, barcode, dan seluruh zona wajib akan diverifikasi ulang pada tahap validasi prepress. " +
  "Jangan gunakan file ini untuk cetak produksi sebelum mendapatkan konfirmasi 'Siap Cetak' dari tim kami.";

/**
 * Attach disclaimer to an order response object when the order is not yet print-ready.
 * Does nothing (returns order as-is) when printReadyAt is set.
 */
export function withDisclaimer<T extends { printReadyAt?: Date | string | null }>(
  order: T,
): T & { _disclaimer?: string } {
  if (order.printReadyAt) return order;
  return { ...order, _disclaimer: PRINT_READY_DISCLAIMER };
}
