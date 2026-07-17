/**
 * imageValidator.ts — Team 16: Presentation & Document Creative Services
 *
 * Secure image URL validation and fetching for document/presentation generation.
 *
 * Wraps the existing platform SSRF guard (middleware/ssrfGuard.ts → validateExternalUrl)
 * and adds:
 *   - Response size limit enforcement (MAX_SOURCE_ASSET_BYTES)
 *   - Per-fetch timeout (IMAGE_FETCH_TIMEOUT_MS)
 *   - Redirect re-validation (the final URL after redirects is re-checked)
 *   - MIME type validation from magic bytes
 *
 * Pattern follows services/design-renderer/imageResolver.ts which is the
 * canonical image fetch pattern on this platform. We do NOT duplicate that
 * logic — we re-use the same validateExternalUrl() primitive and mirror the
 * same fetch-with-timeout + size-guard approach.
 */

import { validateExternalUrl } from "../../middleware/ssrfGuard.js";
import { RESOURCE_LIMITS, enforceSourceAssetBytes } from "./resourceLimits.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ImageValidationCode =
  | "SSRF_BLOCKED"
  | "INVALID_URL"
  | "PROTOCOL_NOT_ALLOWED"
  | "SIZE_EXCEEDED"
  | "FETCH_TIMEOUT"
  | "FETCH_FAILED"
  | "MIME_NOT_ALLOWED"
  | "EMPTY_BODY";

export type ImageValidationResult =
  | { valid: true }
  | { valid: false; code: ImageValidationCode; reason: string };

// ── MIME whitelist (magic-byte detection) ─────────────────────────────────────

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);

function detectMime(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)                     return "image/jpeg";
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return "image/webp";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46)                     return "image/gif";
  const head = buf.slice(0, 256).toString("utf8");
  if (head.includes("<svg") || head.includes("<?xml"))                            return "image/svg+xml";
  return null;
}

// ── URL validation (synchronous) ──────────────────────────────────────────────

/**
 * Validate an external image URL before fetching.
 * Delegates to the platform's validateExternalUrl() for SSRF rules.
 * Returns { valid: true } or { valid: false, code, reason }.
 */
export function validateImageUrl(rawUrl: string): ImageValidationResult {
  if (!rawUrl || typeof rawUrl !== "string") {
    return { valid: false, code: "INVALID_URL", reason: "URL must be a non-empty string" };
  }

  const ssrf = validateExternalUrl(rawUrl);
  if (!ssrf.valid) {
    // Distinguish protocol errors from IP/host blocks for clearer test assertions
    let code: ImageValidationCode = "SSRF_BLOCKED";
    try {
      const { protocol } = new URL(rawUrl);
      if (!["http:", "https:"].includes(protocol)) code = "PROTOCOL_NOT_ALLOWED";
    } catch {
      code = "INVALID_URL";
    }
    return { valid: false, code, reason: ssrf.reason ?? "SSRF check failed" };
  }

  return { valid: true };
}

// ── Async fetch with full validation ─────────────────────────────────────────

export interface FetchedImage {
  buffer:   Buffer;
  mimeType: string;
  bytes:    number;
}

export interface FetchImageOptions {
  /** Byte ceiling per image. Defaults to RESOURCE_LIMITS.MAX_SOURCE_ASSET_BYTES. */
  maxBytes?:   number;
  /** Fetch timeout in ms. Defaults to RESOURCE_LIMITS.IMAGE_FETCH_TIMEOUT_MS. */
  timeoutMs?:  number;
}

/**
 * Fetch an external image URL with SSRF guard + size limit + timeout.
 * Throws an Error with a code property on any violation.
 *
 * This function is the Team 16 equivalent of imageResolver.fetchRemoteImage()
 * in the design-renderer — same pattern, no new dependencies.
 */
export async function fetchValidatedImage(
  rawUrl: string,
  opts?: FetchImageOptions,
): Promise<FetchedImage> {
  const maxBytes  = opts?.maxBytes  ?? RESOURCE_LIMITS.MAX_SOURCE_ASSET_BYTES;
  const timeoutMs = opts?.timeoutMs ?? RESOURCE_LIMITS.IMAGE_FETCH_TIMEOUT_MS;

  // 1. Validate URL before making any network request
  const urlCheck = validateImageUrl(rawUrl);
  if (!urlCheck.valid) {
    const err = Object.assign(new Error(urlCheck.reason), { code: urlCheck.code });
    throw err;
  }

  // 2. Fetch with timeout
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(rawUrl, { signal: controller.signal, redirect: "follow" });
  } catch (err: unknown) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    const code: ImageValidationCode = isAbort ? "FETCH_TIMEOUT" : "FETCH_FAILED";
    throw Object.assign(new Error(isAbort ? `Image fetch timed out: ${rawUrl}` : `Image fetch failed: ${rawUrl}`), { code });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw Object.assign(new Error(`Image fetch returned ${response.status}: ${rawUrl}`), { code: "FETCH_FAILED" as ImageValidationCode });
  }

  // 3. Re-validate the final URL after redirects
  const finalUrl = response.url;
  if (finalUrl && finalUrl !== rawUrl) {
    const redirectCheck = validateExternalUrl(finalUrl);
    if (!redirectCheck.valid) {
      throw Object.assign(
        new Error(`Image redirect to blocked URL: ${redirectCheck.reason}`),
        { code: "SSRF_BLOCKED" as ImageValidationCode },
      );
    }
  }

  // 4. Enforce size from Content-Length header (early exit before body download)
  const contentLength = parseInt(response.headers.get("content-length") ?? "0", 10);
  if (contentLength > maxBytes) {
    throw Object.assign(
      new Error(`Image Content-Length (${contentLength}) exceeds limit (${maxBytes})`),
      { code: "SIZE_EXCEEDED" as ImageValidationCode },
    );
  }

  // 5. Download body and enforce size
  const arrayBuf = await response.arrayBuffer();
  const buffer   = Buffer.from(arrayBuf);

  enforceSourceAssetBytes(buffer.length); // throws ResourceLimitError if too large

  // 6. MIME validation from magic bytes
  const mimeType = detectMime(buffer);
  if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) {
    throw Object.assign(
      new Error(`Image MIME type not allowed: ${mimeType ?? "unknown"}`),
      { code: "MIME_NOT_ALLOWED" as ImageValidationCode },
    );
  }

  if (buffer.length === 0) {
    throw Object.assign(new Error(`Empty image body from: ${rawUrl}`), { code: "EMPTY_BODY" as ImageValidationCode });
  }

  return { buffer, mimeType, bytes: buffer.length };
}
