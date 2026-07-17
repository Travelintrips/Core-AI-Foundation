// Team 10 — Font URL Guard (SSRF Prevention)
//
// POLICY:
//   - Only Google Fonts CSS endpoints are accepted.
//   - All other hosts, IP-literal addresses, private ranges,
//     and non-HTTPS schemes are rejected.
//   - Redirect following is explicitly prohibited by policy (no network
//     fetch occurs here; the guard validates before storage so any consumer
//     that later fetches the URL is pre-constrained to safe values).
//   - MIME expectation: Google Fonts CSS endpoint always returns text/css.
//     Only CSS URLs are accepted (css / css2 path).
//   - Response-size limit and timeout are enforced at fetch time by
//     any consumer; guard documents the expected values.
//
// PREFERRED APPROACH: store the font family identifier only and construct
// the URL server-side via buildGoogleFontsUrl(). Accepting a pre-built URL
// is kept for backwards compatibility but is stricter than identifier-only.

/** Only these hosts are ever allowed in a stored font URL. */
const ALLOWED_HOSTS = new Set([
  "fonts.googleapis.com",
  "fonts.gstatic.com",
]);

/**
 * Google Fonts CSS endpoint pattern.
 * Accepts css and css2, with a `family` query parameter.
 * Example: https://fonts.googleapis.com/css2?family=Inter:wght@400;700
 */
const GOOGLE_FONTS_CSS_RE =
  /^https:\/\/fonts\.googleapis\.com\/css2?\?(.+)$/;

/**
 * Block hostnames that resolve to private / loopback / link-local space.
 * This covers the most common SSRF bypass patterns; domain-level
 * allowlisting above is the primary defence for URL inputs.
 */
const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127(?:\.\d+){3}$/,                   // 127.0.0.0/8
  /^10(?:\.\d+){3}$/,                    // 10.0.0.0/8
  /^172\.(?:1[6-9]|2\d|3[01])(?:\.\d+){2}$/, // 172.16.0.0/12
  /^192\.168(?:\.\d+){2}$/,             // 192.168.0.0/16
  /^169\.254(?:\.\d+){2}$/,             // 169.254.0.0/16  link-local
  /^\[?::1\]?$/,                         // IPv6 loopback
  /^\[?fc[0-9a-f]{2}:/i,                // IPv6 unique-local fc00::/7
  /^\[?fd[0-9a-f]{2}:/i,                // IPv6 unique-local fd00::/8
  /^\[?fe80:/i,                          // IPv6 link-local
  /^\d+\.\d+\.\d+\.\d+$/,              // Any raw IPv4 literal (catch-all — domain required)
  /^\[.*\]$/,                            // Any raw IPv6 literal
];

export type FontUrlValidationResult =
  | { valid: true; canonicalUrl: string; familyIdentifier: string }
  | { valid: false; error: string };

/**
 * Validate a Google Fonts URL before storing it.
 *
 * Returns `{ valid: true, canonicalUrl, familyIdentifier }` on success.
 * Returns `{ valid: false, error }` on any violation.
 *
 * Consumer responsibility (at fetch time, not here):
 *   - Follow at most 0 redirects (no redirect following).
 *   - Enforce 10 s timeout.
 *   - Cap response body at 512 KiB.
 *   - Validate Content-Type: text/css.
 */
export function validateGoogleFontsUrl(url: string): FontUrlValidationResult {
  // ── Basic structure ────────────────────────────────────────────────────────
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: "Invalid URL: could not parse" };
  }

  // ── Protocol ──────────────────────────────────────────────────────────────
  if (parsed.protocol !== "https:") {
    return {
      valid: false,
      error: "Font URLs must use HTTPS — other schemes are not permitted",
    };
  }

  // ── Private / loopback host block ─────────────────────────────────────────
  const hostname = parsed.hostname.toLowerCase();
  for (const pattern of PRIVATE_HOST_PATTERNS) {
    if (pattern.test(hostname)) {
      return {
        valid: false,
        error: `Font URL hostname "${hostname}" resolves to a private, loopback, or link-local address — not permitted`,
      };
    }
  }

  // ── Host allowlist ────────────────────────────────────────────────────────
  if (!ALLOWED_HOSTS.has(hostname)) {
    return {
      valid: false,
      error: `Font URL host must be one of: ${[...ALLOWED_HOSTS].join(", ")}. Got: ${hostname}`,
    };
  }

  // ── Endpoint pattern (CSS only) ───────────────────────────────────────────
  if (!GOOGLE_FONTS_CSS_RE.test(url)) {
    return {
      valid: false,
      error:
        "Font URL must be a Google Fonts CSS endpoint: " +
        "https://fonts.googleapis.com/css2?family=<FontName>",
    };
  }

  // ── Extract family identifier ─────────────────────────────────────────────
  const familyParam = parsed.searchParams.get("family");
  if (!familyParam) {
    return {
      valid: false,
      error: "Font URL must include a `family` query parameter",
    };
  }

  // Strip weight/axis specs: "Inter:wght@400;700" → "Inter"
  const familyIdentifier = familyParam.split(":")[0].split("|")[0].trim();
  if (!familyIdentifier) {
    return { valid: false, error: "Font URL `family` parameter is empty" };
  }

  // Reconstruct a canonical URL from the extracted identifier to normalise input
  const canonicalUrl = buildGoogleFontsUrl(familyIdentifier);

  return { valid: true, canonicalUrl, familyIdentifier };
}

/**
 * Construct a canonical Google Fonts CSS URL from a plain font family name.
 * Use this instead of accepting arbitrary URLs — preferred per SSRF policy.
 *
 * Example: buildGoogleFontsUrl("Inter") →
 *   "https://fonts.googleapis.com/css2?family=Inter&display=swap"
 */
export function buildGoogleFontsUrl(familyIdentifier: string): string {
  // Sanitise: allow only characters valid in a Google Fonts family name
  const safe = familyIdentifier.replace(/[^a-zA-Z0-9 +]/g, "").trim();
  if (!safe) throw new Error("Invalid font family identifier");
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(safe)}&display=swap`;
}

/**
 * Expected fetch-time constraints for any code that later retrieves a stored
 * Google Fonts URL. Consumers MUST respect these values.
 */
export const FONT_FETCH_CONSTRAINTS = {
  /** Maximum redirects to follow. Zero — Google Fonts CSS does not redirect. */
  maxRedirects: 0,
  /** Network timeout in milliseconds. */
  timeoutMs: 10_000,
  /** Maximum response body size in bytes. */
  maxResponseBytes: 512 * 1024, // 512 KiB
  /** Only these Content-Type values are acceptable. */
  allowedMimeTypes: ["text/css"],
} as const;
