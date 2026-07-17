/**
 * graphic-design/sanitize.ts — Team 15
 *
 * Path and filename sanitization for graphic design deliverables.
 *
 * Rules (P0 PATH TRAVERSAL):
 *  - Never accept output filename/path from user input.
 *  - Always generate UUID-based paths.
 *  - Use a fixed storage prefix so all files stay in one directory.
 *  - Validate extension against an explicit allowlist.
 *  - Run posix.normalize then a containment check after every join.
 *  - Reject (fallback to safe defaults) any input that would escape.
 */

import { posix } from "path";
import { randomUUID } from "crypto";

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * All GD deliverable files live under this prefix in object storage.
 * Nothing in this domain should ever write outside of it.
 */
export const GD_STORAGE_PREFIX = "graphic-design/";

/**
 * Allowlist of file extensions accepted for graphic design deliverables.
 * Anything not on this list is treated as untrusted and rejected.
 */
export const ALLOWED_GD_EXTENSIONS = new Set([
  "pdf", "png", "svg", "jpg", "jpeg",
  "eps", "ai", "psd", "zip", "json",
]);

/**
 * Allowlist of color modes accepted in a RenderedDeliverable.
 * Rejects anything a user might inject into the colorMode field.
 */
export const ALLOWED_COLOR_MODES = new Set(["RGB", "sRGB", "CMYK"]);

// ── Sanitizers ────────────────────────────────────────────────────────────────

/**
 * Convert a raw user-supplied format string to a safe file extension.
 * Returns null if the input is not in the allowlist.
 *
 * Inputs like "../../etc/passwd", ".env", "exe", "" all return null.
 */
export function sanitizeFormatExt(raw: string): string | null {
  // Keep only the final component after any slash (strip path traversal)
  const basename = raw.replace(/\\/g, "/").split("/").pop() ?? "";
  // Strip leading dot (e.g. ".pdf" → "pdf")
  const normalized = basename.toLowerCase().trim().replace(/^\.+/, "").replace(/[. ]+$/, "");
  return ALLOWED_GD_EXTENSIONS.has(normalized) ? normalized : null;
}

/**
 * Sanitize an array of format strings from user/renderer input.
 * Unknown extensions are silently dropped (fail-closed).
 */
export function sanitizeFileFormats(raw: string[]): string[] {
  return raw.flatMap((f) => {
    const ext = sanitizeFormatExt(f);
    return ext ? [ext] : [];
  });
}

/**
 * Sanitize a variant key from user/renderer input.
 * Keeps only alphanumeric, underscore, and hyphen characters.
 * Truncates to 100 chars. Falls back to "default" if empty.
 */
export function sanitizeVariantKey(raw: string): string {
  const cleaned = raw.replace(/[^a-z0-9_-]/gi, "").slice(0, 100);
  return cleaned || "default";
}

/**
 * Sanitize a service code from a route param.
 * Keeps only uppercase letters, digits, and hyphens.
 */
export function sanitizeServiceCode(raw: string): string {
  return raw.replace(/[^A-Z0-9-]/g, "").slice(0, 30);
}

// ── Path generation ───────────────────────────────────────────────────────────

/**
 * Generate a safe, UUID-based object storage path for a deliverable file.
 *
 * The path is NEVER derived from user input — the caller provides only:
 *  - serviceCode  (sanitized to alphanumeric + hyphen)
 *  - ext          (validated against ALLOWED_GD_EXTENSIONS)
 *
 * Path structure: graphic-design/{SAFE_CODE}/{UUID}.{EXT}
 *
 * After normalisation a containment check verifies the result stays
 * inside GD_STORAGE_PREFIX. If any step fails, a safe fallback is returned.
 */
export function buildDeliverablePath(serviceCode: string, ext: string): string {
  const safeExt  = sanitizeFormatExt(ext) ?? "bin";
  const safeCode = serviceCode.replace(/[^A-Z0-9-]/g, "").slice(0, 20) || "UNKNOWN";
  const id       = randomUUID();   // never from user input

  const candidate = posix.normalize(`${GD_STORAGE_PREFIX}${safeCode}/${id}.${safeExt}`);
  return assertPathContained(candidate, GD_STORAGE_PREFIX)
    ? candidate
    : `${GD_STORAGE_PREFIX}fallback/${id}.bin`;
}

/**
 * Assert that `filePath` is contained within `prefix`.
 * Returns true if safe, false if the path would escape.
 *
 * Rejects:
 *  - Absolute paths  (starts with "/")
 *  - Traversal paths (starts with "..")
 *  - Paths outside prefix
 */
export function assertPathContained(filePath: string, prefix: string): boolean {
  if (filePath.startsWith("/"))  return false;
  if (filePath.startsWith("..")) return false;
  if (!filePath.startsWith(prefix)) return false;
  return true;
}

// ── Color mode validator ──────────────────────────────────────────────────────

/**
 * Validate a color mode string from renderer input.
 * Falls back to "RGB" for any unknown value.
 */
export function sanitizeColorMode(raw: string): "RGB" | "sRGB" | "CMYK" {
  return (ALLOWED_COLOR_MODES.has(raw) ? raw : "RGB") as "RGB" | "sRGB" | "CMYK";
}
