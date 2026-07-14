import type { Request, Response, NextFunction } from "express";
import { verifySessionToken, getInternalUserById, SESSION_COOKIE_NAME } from "../services/internalAuthService.js";

/**
 * Admin API key middleware.
 *
 * Accepts either:
 *   1. A valid ADMIN_API_KEY in one of these headers:
 *        Authorization: Bearer <key>
 *        x-admin-key: <key>
 *        x-admin-api-key: <key>
 *   2. A valid internal user session cookie (from the Internal AI Portal login).
 *      Any active internal user session is treated as having admin access.
 *
 * If ADMIN_API_KEY is not set in development, the middleware allows all traffic
 * (dev fail-open convenience).
 */
export const requireAdminApiKey = adminAuth;

export async function adminAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  // ── Path 1: session cookie from internal user login ───────────────────────
  const sessionToken = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE_NAME];
  if (sessionToken) {
    const payload = verifySessionToken(sessionToken);
    if (payload) {
      const user = await getInternalUserById(payload.sub);
      if (user && user.status === "active" && user.accountType === "internal") {
        req.internalUser = user;
        next();
        return;
      }
    }
  }

  // ── Path 2: ADMIN_API_KEY header ──────────────────────────────────────────
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
  const xAdminKey = (req.headers["x-admin-key"] ?? req.headers["x-admin-api-key"]) as string | undefined;

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

/**
 * Method-aware exemptions for customer-facing endpoints that live under an
 * otherwise-admin-protected mount point (e.g. GET /ai/catalog/services/:id is
 * public, but PATCH/DELETE on the same path are admin-only).
 *
 * Deliberately explicit and anchored — NEVER widen these to prefix/substring
 * matches like `req.path.startsWith("/ai/catalog/services")`, which would
 * also expose the admin create/update/delete routes on the same mount.
 *
 * Phase 2.2 audit (see .agents/memory/phase22-public-route-auth-hotfix.md):
 * these three route groups were the ones customers actually call from the
 * portal (service detail, quote calculator, create request, portfolio
 * showcase, live AI preview) and were incorrectly requiring ADMIN_API_KEY.
 */
const PUBLIC_ROUTE_RULES: { method: string; pattern: RegExp }[] = [
  // Service detail / quote / request-service (catalog.ts) — public because
  // assertServiceIsPubliclyRequestable() still gates the underlying
  // category visibility server-side.
  { method: "GET", pattern: /^\/ai\/catalog\/services\/\d+$/ },
  { method: "POST", pattern: /^\/ai\/catalog\/services\/\d+\/quote$/ },
  { method: "POST", pattern: /^\/ai\/catalog\/services\/\d+\/request$/ },
  // Portfolio showcase + live AI preview (portfolio.ts) — customer-facing;
  // preview creation is separately rate-limited per session
  // (MAX_PREVIEWS_PER_SESSION in livePreviewService.ts), not by admin key.
  { method: "GET", pattern: /^\/ai\/portfolio\/services\/\d+\/showcase$/ },
  { method: "POST", pattern: /^\/ai\/portfolio\/portfolios\/\d+\/view$/ },
  { method: "POST", pattern: /^\/ai\/portfolio\/preview$/ },
  { method: "GET", pattern: /^\/ai\/portfolio\/preview\/\d+$/ },
  { method: "GET", pattern: /^\/ai\/portfolio\/preview\/session\/[^/]+\/count$/ },
  { method: "POST", pattern: /^\/ai\/portfolio\/preview\/\d+\/continue$/ },
];

export function adminAuthWithExceptions(req: Request, res: Response, next: NextFunction): void {
  for (const prefix of PUBLIC_PATH_PREFIXES) {
    if (req.path === prefix || req.path.startsWith(prefix + "/")) {
      next();
      return;
    }
  }
  for (const rule of PUBLIC_ROUTE_RULES) {
    if (req.method === rule.method && rule.pattern.test(req.path)) {
      next();
      return;
    }
  }
  adminAuth(req, res, next);
}
