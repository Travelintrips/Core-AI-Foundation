/**
 * publicBaseUrl — canonical base URL resolver
 *
 * Priority order:
 *  1. PUBLIC_APP_URL env var — set this in production to the custom domain
 *     (e.g. https://aicore.cstlogistic.co.id) so emails/links use the real URL.
 *  2. REPLIT_DEV_DOMAIN — Replit-injected dev domain (UUID-style .replit.dev).
 *  3. Request headers (x-forwarded-proto / x-forwarded-host) — Express fallback.
 *  4. http://localhost:<PORT> — background-job / no-request fallback.
 */

type MinimalRequest = {
  headers: Record<string, string | string[] | undefined>;
  protocol: string;
  get(header: string): string | undefined;
};

/** Use when an Express request is available (most routes). */
export function getPublicBaseUrl(req?: MinimalRequest): string {
  // 1. Explicit production override — highest priority
  if (process.env["PUBLIC_APP_URL"]) {
    return process.env["PUBLIC_APP_URL"].replace(/\/$/, "");
  }

  // 2. Replit dev domain
  if (process.env["REPLIT_DEV_DOMAIN"]) {
    return `https://${process.env["REPLIT_DEV_DOMAIN"]}`;
  }

  // 3. Request-derived (reverse-proxy safe)
  if (req) {
    const proto =
      (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] ??
      req.protocol;
    const host =
      (req.headers["x-forwarded-host"] as string | undefined) ??
      req.get("host") ??
      "localhost";
    return `${proto}://${host}`;
  }

  // 4. Background-job fallback
  return `http://localhost:${process.env["PORT"] ?? 8080}`;
}
