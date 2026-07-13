import type { Request, Response, NextFunction } from "express";

/**
 * Admin API key middleware.
 *
 * Reads ADMIN_API_KEY from env. If the env var is not set, the middleware
 * allows all traffic (development fail-open).
 *
 * Accepted header formats:
 *   Authorization: Bearer <key>
 *   x-admin-key: <key>
 */
export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const adminKey = process.env["ADMIN_API_KEY"];

  if (!adminKey) {
    if (process.env["NODE_ENV"] === "development") {
      // No key configured in development — allow all (dev convenience)
      next();
      return;
    }
    // Outside development: fail-closed to avoid accidental public exposure
    res.status(401).json({ error: "Unauthorized: ADMIN_API_KEY is not configured" });
    return;
  }

  const authHeader = req.headers["authorization"] as string | undefined;
  const xAdminKey = req.headers["x-admin-key"] as string | undefined;

  let token: string | null = null;

  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  } else if (xAdminKey) {
    token = xAdminKey.trim();
  }

  if (token !== adminKey) {
    res.status(401).json({ error: "Unauthorized: invalid or missing admin API key" });
    return;
  }

  next();
}

/** Paths that bypass auth entirely (health checks + public client review) */
const PUBLIC_PATH_PREFIXES = [
  "/healthz",
  "/health",
  "/ai/health",
  "/ai/healthz",
  "/public",   // public client review endpoints — token-protected, not admin-key-protected
  "/storage/public-objects", // unconditionally public asset serving (object-storage skill convention)
  "/ai/catalog/public", // customer-facing catalog — must never require the admin key
  "/internal/auth/login", // internal staff login — must be reachable before a session exists
];

export function adminAuthWithExceptions(req: Request, res: Response, next: NextFunction): void {
  for (const prefix of PUBLIC_PATH_PREFIXES) {
    if (req.path === prefix || req.path.startsWith(prefix + "/")) {
      next();
      return;
    }
  }
  adminAuth(req, res, next);
}
