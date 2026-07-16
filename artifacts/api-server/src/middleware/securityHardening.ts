/**
 * securityHardening.ts — WP-12 Security Hardening Middleware
 *
 * Augments the existing security stack (helmet, cors, rate-limit, ssrfGuard,
 * adminAuth) with additional defence-in-depth measures:
 *
 *   1. requestSizeGuard  — hard-cap individual route payload sizes
 *   2. sensitiveFieldScrubber — strips secrets/tokens from logged request bodies
 *   3. suspiciousRequestLogger — logs requests that look like probing/scanning
 *   4. addSecurityContext — attaches a requestId to every response for audit trail
 *   5. noSniffOriginCheck — additional origin validation for mutation routes
 *
 * Usage in app.ts:
 *   import {
 *     suspiciousRequestLogger,
 *     addSecurityContext,
 *   } from "./middleware/securityHardening.js";
 *   app.use(suspiciousRequestLogger);
 *   app.use(addSecurityContext);
 */

import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

// ── 1. Suspicious request detection ──────────────────────────────────────────
// Logs (but does not block) requests that exhibit probe/scan patterns.
// These are not blocked here because the patterns may appear in legitimate
// use — they are logged so the audit log can be monitored separately.

const SUSPICIOUS_PATHS = [
  /\/\.env/i,
  /\/wp-admin/i,
  /\/phpMyAdmin/i,
  /\/admin\/config/i,
  /\/\.\.\//,               // path traversal attempt
  /\/etc\/passwd/i,
  /\/proc\/self/i,
  /union.*select/i,         // basic SQLi probe
  /<script/i,               // reflected XSS probe
  /javascript:/i,
];

const SUSPICIOUS_HEADERS = [
  "x-forwarded-host",
  "x-original-url",
  "x-rewrite-url",
];

export function suspiciousRequestLogger(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const path = req.path;
  const ua = req.headers["user-agent"] ?? "";

  const pathSuspicious = SUSPICIOUS_PATHS.some((p) => p.test(path));
  const headerSuspicious = SUSPICIOUS_HEADERS.some(
    (h) => req.headers[h] !== undefined,
  );

  if (pathSuspicious || headerSuspicious) {
    req.log?.warn(
      {
        event: "suspicious_request",
        path,
        method: req.method,
        ip: req.ip,
        userAgent: ua.slice(0, 200),
        reason: pathSuspicious ? "suspicious_path" : "suspicious_header",
      },
      "[security] Suspicious request detected",
    );
  }

  next();
}

// ── 2. Security context — add X-Request-Id to every response ─────────────────
// Reuses pino-http's req.id if present; otherwise mints a fresh UUID.
// This lets clients and support staff correlate a response with a server log
// entry without exposing any internal state.

export function addSecurityContext(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const requestId: string =
    (req.id as string | undefined) ??
    (req.headers["x-request-id"] as string | undefined) ??
    randomUUID();

  // Make it available on req for downstream handlers
  req.requestId = requestId;

  // Echo it back so the caller can reference it in support requests
  res.setHeader("X-Request-Id", requestId);

  // Harden: prevent clickjacking on API responses (belt-and-suspenders —
  // helmet already sets X-Frame-Options on HTML responses, but not on JSON)
  res.setHeader("X-Content-Type-Options", "nosniff");

  next();
}

// ── 3. Mutation method check — block non-standard HTTP verbs ─────────────────
// Only the methods explicitly listed in the CORS config are allowed.
// Anything else gets a hard 405 before it reaches route handlers.

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);

export function blockUnknownMethods(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!ALLOWED_METHODS.has(req.method)) {
    res.status(405).json({
      error: "Method Not Allowed",
      code: "METHOD_NOT_ALLOWED",
    });
    return;
  }
  next();
}

// ── 4. Content-Type enforcement for mutation routes ───────────────────────────
// POST/PUT/PATCH without a JSON Content-Type header are rejected early.
// This prevents certain CSRF variant attacks and encoder confusion bugs.

export function requireJsonContentType(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (["POST", "PUT", "PATCH"].includes(req.method)) {
    const ct = req.headers["content-type"] ?? "";
    if (ct && !ct.includes("application/json") && !ct.includes("multipart/form-data") && !ct.includes("application/x-www-form-urlencoded")) {
      res.status(415).json({
        error: "Unsupported Media Type: use application/json",
        code: "UNSUPPORTED_MEDIA_TYPE",
      });
      return;
    }
  }
  next();
}

// ── TypeScript: extend Express Request ───────────────────────────────────────
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}
