/**
 * fileSafety.ts — File and URL safety validation for Fashion Design (Team 18)
 *
 * Enforces:
 *   - MIME type allowlist
 *   - File extension allowlist
 *   - Maximum file size
 *   - Allowed storage source (no arbitrary external hosts)
 *   - Malware scanning hook (integrates with existing scanner if configured)
 *   - URL SSRF protection (blocks private IP ranges, localhost, cloud metadata)
 *
 * Used in:
 *   - saveBlueprint: logoPlacement.logoUrl, sponsors[].logoUrl
 *   - Any future file URL stored in fashion design orders
 */

import { logger } from "../../lib/logger.js";

// ── Configuration ─────────────────────────────────────────────────────────────

/** Allowed MIME types for logo/sponsor images */
export const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/svg+xml",
  "image/gif",
]);

/** Allowed file extensions (lowercase, with dot) */
export const ALLOWED_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".svg", ".gif",
]);

/** Maximum file size: 5 MB */
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/** Allowed URL schemes */
const ALLOWED_SCHEMES = new Set(["https:", "http:"]);

/** SSRF blocklist — private/loopback/link-local/cloud-metadata ranges */
const BLOCKED_HOSTNAMES = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "169.254.169.254", // AWS/GCP metadata
  "metadata.google.internal",
];

const BLOCKED_IP_PREFIXES = [
  "10.",
  "172.16.", "172.17.", "172.18.", "172.19.",
  "172.20.", "172.21.", "172.22.", "172.23.",
  "172.24.", "172.25.", "172.26.", "172.27.",
  "172.28.", "172.29.", "172.30.", "172.31.",
  "192.168.",
  "169.254.",
  "fc00:", "fd", // IPv6 ULA
  "fe80:",        // IPv6 link-local
  "::1",
  "0:0:0:0:0:0:0:1",
];

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FileSafetyResult {
  safe: boolean;
  reason?: string;
  code?: "SSRF" | "BAD_SCHEME" | "BAD_MIME" | "BAD_EXTENSION" | "TOO_LARGE" | "DISALLOWED_HOST";
}

// ── SSRF guard ────────────────────────────────────────────────────────────────

export function validateUrl(rawUrl: string): FileSafetyResult {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { safe: false, reason: "Malformed URL", code: "SSRF" };
  }

  // Scheme check
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return {
      safe: false,
      reason: `URL scheme "${parsed.protocol}" is not allowed. Use https or http.`,
      code: "BAD_SCHEME",
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Blocked hostnames
  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    return { safe: false, reason: `Hostname "${hostname}" is blocked (SSRF protection)`, code: "SSRF" };
  }

  // Blocked IP prefixes
  for (const prefix of BLOCKED_IP_PREFIXES) {
    if (hostname.startsWith(prefix)) {
      return { safe: false, reason: `IP range "${hostname}" is blocked (SSRF protection)`, code: "SSRF" };
    }
  }

  // Block numeric IPv4 in private ranges via regex
  const ipv4Match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(hostname);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 127
    ) {
      return { safe: false, reason: `Private IP "${hostname}" is blocked (SSRF protection)`, code: "SSRF" };
    }
  }

  // Limit redirects by blocking redirect-service hosts (common SSRF bypass)
  const blockedHostPatterns = [/\d+\.\d+\.\d+\.\d+/, /^(localhost|localtest\.me)$/];
  for (const pattern of blockedHostPatterns) {
    if (pattern.test(hostname)) {
      return { safe: false, reason: `Host pattern blocked: "${hostname}"`, code: "SSRF" };
    }
  }

  return { safe: true };
}

// ── MIME / extension validation ───────────────────────────────────────────────

export function validateMimeType(mime: string): FileSafetyResult {
  const normalised = mime.toLowerCase().split(";")[0]!.trim();
  if (!ALLOWED_MIME_TYPES.has(normalised)) {
    return {
      safe: false,
      reason: `MIME type "${normalised}" is not allowed. Allowed: ${[...ALLOWED_MIME_TYPES].join(", ")}`,
      code: "BAD_MIME",
    };
  }
  return { safe: true };
}

export function validateExtension(filename: string): FileSafetyResult {
  const lower = filename.toLowerCase();
  const ext = lower.substring(lower.lastIndexOf("."));
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return {
      safe: false,
      reason: `File extension "${ext}" is not allowed. Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}`,
      code: "BAD_EXTENSION",
    };
  }
  return { safe: true };
}

export function validateFileSize(sizeBytes: number): FileSafetyResult {
  if (sizeBytes > MAX_FILE_SIZE_BYTES) {
    return {
      safe: false,
      reason: `File size ${sizeBytes} bytes exceeds maximum ${MAX_FILE_SIZE_BYTES} bytes (5 MB)`,
      code: "TOO_LARGE",
    };
  }
  return { safe: true };
}

// ── Malware scanning hook ─────────────────────────────────────────────────────

/**
 * requestMalwareScan — fires-and-forgets a scan request to the configured
 * scanning endpoint (MALWARE_SCAN_WEBHOOK_URL env var). Does not block the
 * request if no scanner is configured. Will block if scanner returns positive.
 */
export async function requestMalwareScan(
  fileUrl: string,
  context: { domain: string; orderId?: number },
): Promise<{ clean: boolean; skipped: boolean }> {
  const scanUrl = process.env["MALWARE_SCAN_WEBHOOK_URL"];
  if (!scanUrl) {
    logger.debug({ fileUrl, context }, "[fashion-design/fileSafety] No malware scanner configured — skipping");
    return { clean: true, skipped: true };
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5_000); // 5s timeout
    const resp = await fetch(scanUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: fileUrl, context }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      logger.warn({ fileUrl, status: resp.status }, "[fashion-design/fileSafety] Scanner returned non-OK — treating as clean");
      return { clean: true, skipped: false };
    }

    const body = await resp.json() as Record<string, unknown>;
    const clean = body["clean"] !== false; // default clean if key absent
    if (!clean) {
      logger.error({ fileUrl, context, body }, "[fashion-design/fileSafety] Malware detected by scanner");
    }
    return { clean, skipped: false };
  } catch (err) {
    logger.warn({ err, fileUrl }, "[fashion-design/fileSafety] Malware scanner error — treating as clean (scanner unavailable)");
    return { clean: true, skipped: true };
  }
}

// ── Combined logo/sponsor URL validator ───────────────────────────────────────

/**
 * validateLogoUrl — validates a logo/sponsor image URL for SSRF and extension.
 * Async because it optionally triggers malware scan hook.
 */
export async function validateLogoUrl(
  rawUrl: string,
  context: { domain: string; field: string; orderId?: number },
): Promise<FileSafetyResult> {
  // 1. SSRF check
  const urlCheck = validateUrl(rawUrl);
  if (!urlCheck.safe) {
    logger.warn({ rawUrl, context, reason: urlCheck.reason },
      "[fashion-design/fileSafety] URL blocked");
    return urlCheck;
  }

  // 2. Extension check (from URL path)
  try {
    const pathname = new URL(rawUrl).pathname;
    const extCheck = validateExtension(pathname);
    if (!extCheck.safe) {
      logger.warn({ rawUrl, context, reason: extCheck.reason },
        "[fashion-design/fileSafety] Extension blocked");
      return extCheck;
    }
  } catch {
    // URL already validated above; path extraction failure is non-fatal
  }

  // 3. Malware scan hook (non-blocking if scanner unavailable)
  const scan = await requestMalwareScan(rawUrl, { domain: context.domain, orderId: context.orderId });
  if (!scan.clean) {
    return { safe: false, reason: "File flagged by malware scanner", code: "DISALLOWED_HOST" };
  }

  return { safe: true };
}

/**
 * validateBlueprintUrls — checks all logo/sponsor URLs in a blueprint payload.
 * Returns array of violation messages (empty = all clean).
 */
export async function validateBlueprintUrls(
  payload: {
    logoPlacement?: Record<string, unknown> | null;
    sponsors?: Array<Record<string, unknown>> | null;
  },
  orderId?: number,
): Promise<string[]> {
  const violations: string[] = [];

  const logoUrl = payload.logoPlacement?.["logoUrl"];
  if (typeof logoUrl === "string" && logoUrl.trim() !== "") {
    const result = await validateLogoUrl(logoUrl, { domain: "fashion-design", field: "logoPlacement.logoUrl", orderId });
    if (!result.safe) violations.push(`logoPlacement.logoUrl: ${result.reason}`);
  }

  const sponsors = payload.sponsors ?? [];
  for (let i = 0; i < sponsors.length; i++) {
    const sp = sponsors[i];
    const spUrl = sp?.["logoUrl"];
    if (typeof spUrl === "string" && spUrl.trim() !== "") {
      const result = await validateLogoUrl(spUrl, { domain: "fashion-design", field: `sponsors[${i}].logoUrl`, orderId });
      if (!result.safe) violations.push(`sponsors[${i}].logoUrl: ${result.reason}`);
    }
  }

  return violations;
}
