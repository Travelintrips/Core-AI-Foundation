/**
 * ssrfGuard.ts — P0-4 SSRF protection.
 *
 * Validates any URL fields in request bodies before they are forwarded
 * to external fetch calls (registry provider URLs, human-task webhook hooks, etc.).
 *
 * Blocks:
 *   • localhost / 127.x.x.x
 *   • Private ranges: 10.x, 172.16-31.x, 192.168.x
 *   • Link-local: 169.254.x (AWS/GCP instance metadata)
 *   • IPv6 private: ::1, fc00::/7, fe80::/10
 *   • Known cloud metadata endpoints
 *   • Non-http/https protocols
 */
import type { Request, Response, NextFunction } from "express";
import { URL } from "url";

const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\./,                            // 127.0.0.0/8
  /^10\./,                             // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./,       // 172.16.0.0/12
  /^192\.168\./,                       // 192.168.0.0/16
  /^169\.254\./,                       // 169.254.0.0/16 (link-local / IMDS)
  /^fc[0-9a-f]{2}:/i,                  // IPv6 ULA fc00::/7
  /^fd[0-9a-f]{2}:/i,
  /^fe[89ab][0-9a-f]:/i,              // IPv6 link-local fe80::/10
  /^::1$/,                             // IPv6 loopback
  /^0\.0\.0\.0/,
];

const BLOCKED_EXACT_HOSTS = new Set([
  "metadata.google.internal",
  "169.254.169.254",   // AWS/GCP/Azure IMDS
  "metadata.internal",
  "metadata.azure.com",
  "data:".split(":")[0], // just in case
]);

/**
 * Validates a single URL string.
 * Returns `{ valid: true }` or `{ valid: false, reason: string }`.
 */
export function validateExternalUrl(rawUrl: string): { valid: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { valid: false, reason: "Invalid URL format" };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { valid: false, reason: `Protocol '${parsed.protocol}' is not allowed. Use http or https.` };
  }

  const host = parsed.hostname.toLowerCase();

  if (BLOCKED_EXACT_HOSTS.has(host)) {
    return { valid: false, reason: "Blocked host (cloud metadata or internal service)" };
  }

  for (const pattern of PRIVATE_HOST_PATTERNS) {
    if (pattern.test(host)) {
      return { valid: false, reason: "Private/internal IP addresses are not allowed" };
    }
  }

  return { valid: true };
}

/**
 * Express middleware that validates URL fields in req.body before the
 * handler runs. Specify which field names to validate.
 *
 * Example:
 *   router.post("/providers", ssrfGuard(["baseUrl", "webhookUrl"]), handler)
 */
export function ssrfGuard(urlFields: string[] = ["url", "baseUrl", "webhookUrl", "notificationHookUrl", "callbackUrl"]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const body = req.body as Record<string, unknown> | undefined;
    if (!body) { next(); return; }

    for (const field of urlFields) {
      const value = body[field];
      if (typeof value === "string" && value.trim().length > 0) {
        const result = validateExternalUrl(value);
        if (!result.valid) {
          res.status(400).json({
            error: `Invalid URL in field '${field}': ${result.reason}`,
            field,
            code: "SSRF_BLOCKED",
          });
          return;
        }
      }
    }
    next();
  };
}
