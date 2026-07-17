/**
 * ssrfFetchValidator.ts — Team 14  (P0)
 *
 * Secure external URL validator and fetcher.
 * Delegates to the project-level validateExternalUrl (ssrfGuard.ts) and
 * adds Team 14–specific guards:
 *
 *   • timeout per fetch
 *   • maximum response bytes
 *   • MIME allowlist (magic-byte detection)
 *   • maximum redirect count (manual following with re-validation)
 *   • post-redirect SSRF re-check
 *
 * This is the ONLY approved path for external resource access in Team 14.
 * All other code that needs a remote URL must call secureFetch() or
 * validateAssetUrl() — never bare fetch().
 */

import { validateExternalUrl } from "../../middleware/ssrfGuard.js";
import { RenderError } from "./errors.js";
import { UNIVERSAL_RENDER_LIMITS } from "./resourceLimits.js";

// ── MIME allowlist ────────────────────────────────────────────────────────────

const ALLOWED_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);

const ALLOWED_FONT_MIMES = new Set([
  "font/woff",
  "font/woff2",
  "font/ttf",
  "font/otf",
  "application/font-woff",
  "application/font-woff2",
  "application/x-font-ttf",
  "application/x-font-opentype",
]);

export const ALLOWED_ASSET_MIMES = new Set([
  ...ALLOWED_IMAGE_MIMES,
  ...ALLOWED_FONT_MIMES,
]);

// ── Magic-byte MIME detection ─────────────────────────────────────────────────

function detectMime(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return "image/webp";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (buf[0] === 0x77 && buf[1] === 0x4f && buf[2] === 0x46 && buf[3] === 0x32) return "font/woff2";
  if (buf[0] === 0x77 && buf[1] === 0x4f && buf[2] === 0x46 && buf[3] === 0x46) return "font/woff";
  const head = buf.slice(0, 512).toString("utf8");
  if (head.includes("<svg") || head.includes("<?xml")) return "image/svg+xml";
  return null;
}

// ── Single-URL SSRF check (no-fetch) ─────────────────────────────────────────

// IPv6 private/loopback patterns using bracketed hostname (e.g. "[::1]")
// URL.hostname returns "[::1]" with brackets for https://[::1]/... — the
// existing ssrfGuard regex /^::1$/ tests without brackets, so we add a
// Team-14-specific supplementary check here.
const BRACKETED_IPV6_PRIVATE = [
  /^\[::1\]$/i,                       // loopback
  /^\[::ffff:/i,                      // IPv4-mapped
  /^\[fc[0-9a-f]{2}:/i,              // ULA fc00::/7
  /^\[fd[0-9a-f]{2}:/i,
  /^\[fe[89ab][0-9a-f]:/i,           // link-local fe80::/10
  /^\[0:0:0:0:0:0:0:1\]/i,           // full-form loopback
];

/**
 * Validate a URL against the project-level SSRF allowlist.
 * Also adds supplementary bracketed-IPv6 private-address detection.
 * Throws RenderError("SSRF_BLOCKED") on violation.
 * Call this for every external URL before use.
 */
export function validateAssetUrl(rawUrl: string): void {
  // Supplementary: bracketed IPv6 private ranges (URL.hostname includes brackets)
  let parsedHost: string | null = null;
  try {
    parsedHost = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    // Let validateExternalUrl handle invalid URLs
  }
  if (parsedHost !== null) {
    for (const pattern of BRACKETED_IPV6_PRIVATE) {
      if (pattern.test(parsedHost)) {
        throw new RenderError("SSRF_BLOCKED", `External URL blocked: IPv6 private/loopback address (${parsedHost})`);
      }
    }
  }

  const check = validateExternalUrl(rawUrl);
  if (!check.valid) {
    throw new RenderError("SSRF_BLOCKED", `External URL blocked: ${check.reason}`);
  }
}

// ── SVG external-reference scanner ───────────────────────────────────────────

const ATTR_URL_RE = /\b(?:href|xlink:href|src)\s*=\s*["']([^"']{8,2048})["']/gi;
const CSS_URL_RE  = /url\(\s*["']?(https?:\/\/[^"')]{8,2048})["']?\s*\)/gi;

/**
 * Scan an SVG string for all external URL references and validate every one.
 * Throws on the first blocked URL.
 *
 * Called by SvgRendererAdapter before any render begins.
 */
export function scanSvgForBlockedUrls(svgString: string): { urlCount: number } {
  const seen = new Set<string>();

  for (const re of [ATTR_URL_RE, CSS_URL_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(svgString)) !== null) {
      const url = m[1]!.trim();
      if (!url.startsWith("http://") && !url.startsWith("https://")) continue;
      if (seen.has(url)) continue;
      seen.add(url);

      // http:// is unconditionally blocked — never silently upgraded
      if (url.startsWith("http://")) {
        throw new RenderError(
          "SSRF_BLOCKED",
          `SVG contains non-HTTPS external URL (http:// is not allowed): ${url.slice(0, 100)}`,
        );
      }

      validateAssetUrl(url);
    }
  }

  if (seen.size > UNIVERSAL_RENDER_LIMITS.MAX_ASSET_COUNT) {
    throw new RenderError(
      "SSRF_BLOCKED",
      `SVG contains too many external URL references (${seen.size} > ${UNIVERSAL_RENDER_LIMITS.MAX_ASSET_COUNT})`,
    );
  }

  return { urlCount: seen.size };
}

// ── Secure fetch ──────────────────────────────────────────────────────────────

export interface SecureFetchOptions {
  maxBytes?:         number;
  timeoutMs?:        number;
  allowedMimeTypes?: Set<string>;
}

/**
 * Fetch an external asset with full SSRF protection:
 *   1. Pre-fetch URL validation
 *   2. Timeout via AbortController
 *   3. Manual redirect following with count limit + re-validation per hop
 *   4. Content-Length pre-check before reading body
 *   5. Body size limit
 *   6. Magic-byte MIME validation
 */
export async function secureFetch(
  url: string,
  opts?: SecureFetchOptions,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const maxBytes  = opts?.maxBytes  ?? UNIVERSAL_RENDER_LIMITS.MAX_ASSET_BYTES;
  const timeoutMs = opts?.timeoutMs ?? UNIVERSAL_RENDER_LIMITS.ASSET_FETCH_TIMEOUT_MS;
  const mimeSet   = opts?.allowedMimeTypes ?? ALLOWED_ASSET_MIMES;

  // ── Step 1: pre-fetch SSRF check ─────────────────────────────────────────
  validateAssetUrl(url);

  // ── Step 2: fetch (no automatic redirect — we follow manually) ────────────
  async function doFetch(target: string): Promise<Response> {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(target, { signal: ctrl.signal, redirect: "manual" });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new RenderError("ASSET_FETCH_TIMEOUT", `Fetch timed out (${timeoutMs}ms): ${target}`);
      }
      throw new RenderError("ASSET_FETCH_FAILED", `Fetch failed: ${target}`);
    } finally {
      clearTimeout(timer);
    }
  }

  let current = url;
  let response = await doFetch(current);
  let redirects = 0;

  while (response.status >= 300 && response.status < 400) {
    if (redirects >= UNIVERSAL_RENDER_LIMITS.MAX_REDIRECTS) {
      throw new RenderError(
        "SSRF_BLOCKED",
        `Too many redirects (>${UNIVERSAL_RENDER_LIMITS.MAX_REDIRECTS}) fetching: ${url}`,
      );
    }
    const location = response.headers.get("location");
    if (!location) {
      throw new RenderError("ASSET_FETCH_FAILED", `Redirect without Location header from: ${current}`);
    }
    const next = new URL(location, current).href;
    // Re-validate redirect target — blocks SSRF via open-redirect
    validateAssetUrl(next);
    current = next;
    redirects++;
    response = await doFetch(current);
  }

  if (!response.ok) {
    throw new RenderError("ASSET_FETCH_FAILED", `HTTP ${response.status} fetching: ${current}`);
  }

  // ── Step 3: pre-body Content-Length guard ─────────────────────────────────
  const clHeader = response.headers.get("content-length");
  if (clHeader) {
    const cl = parseInt(clHeader, 10);
    if (!isNaN(cl) && cl > maxBytes) {
      throw new RenderError(
        "ASSET_TOO_LARGE",
        `Response Content-Length ${cl} exceeds limit ${maxBytes} for: ${current}`,
      );
    }
  }

  // ── Step 4: read body with size guard ─────────────────────────────────────
  const arrayBuf = await response.arrayBuffer();
  const buffer   = Buffer.from(arrayBuf);

  if (buffer.length > maxBytes) {
    throw new RenderError(
      "ASSET_TOO_LARGE",
      `Response body ${buffer.length} bytes exceeds limit ${maxBytes} for: ${current}`,
    );
  }

  if (buffer.length === 0) {
    throw new RenderError("ASSET_FETCH_FAILED", `Empty response body from: ${current}`);
  }

  // ── Step 5: MIME validation via magic bytes ───────────────────────────────
  const mime = detectMime(buffer);
  if (!mime || !mimeSet.has(mime)) {
    throw new RenderError(
      "ASSET_TYPE_INVALID",
      `MIME type '${mime ?? "unknown"}' is not allowed from: ${current}`,
    );
  }

  return { buffer, mimeType: mime };
}
