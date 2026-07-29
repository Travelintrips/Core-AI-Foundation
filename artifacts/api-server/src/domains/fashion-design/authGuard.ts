/**
 * authGuard.ts — Domain-level auth configuration guard (Team 18)
 *
 * WHY THIS EXISTS:
 *   The shared `adminAuth` middleware fails OPEN in NODE_ENV=development when
 *   ADMIN_API_KEY is not configured (dev-convenience behaviour documented in
 *   adminAuth.ts lines 37-41). Team 18's generation endpoints are sensitive
 *   enough that we cannot accept fail-open behaviour in ANY environment.
 *
 * WHAT THIS DOES:
 *   1. Startup guard: logs CRITICAL and marks domain unsafe at module load time
 *      if ADMIN_API_KEY is absent.
 *   2. Runtime middleware: returns 503 (not 401) before adminAuth can fail-open,
 *      making it clear this is a misconfiguration, not an auth rejection.
 *   3. Does NOT replace adminAuth — both run in sequence on admin routes.
 *
 * Integration request for Team 24:
 *   adminAuth should fail-CLOSED in all environments when ADMIN_API_KEY is missing.
 *   See integration/manifests/team-18.json → integrationRequests.
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "../../lib/logger.js";

// ── Startup check ─────────────────────────────────────────────────────────────

let _authConfigured = false;
let _startupChecked = false;

function runStartupCheck(): void {
  if (_startupChecked) return;
  _startupChecked = true;

  const key = process.env["ADMIN_API_KEY"];
  if (!key || key.trim() === "") {
    logger.error(
      { domain: "fashion-design" },
      "[fashion-design] CRITICAL: ADMIN_API_KEY is not configured. " +
        "All fashion-design admin and generation routes will return 503. " +
        "Set ADMIN_API_KEY in environment variables to enable this domain.",
    );
    _authConfigured = false;
  } else {
    _authConfigured = true;
    logger.info({ domain: "fashion-design" }, "[fashion-design] Auth configuration verified OK");
  }
}

// Run immediately at module load (startup guard)
runStartupCheck();

// ── Runtime middleware ────────────────────────────────────────────────────────

/**
 * fashionDesignAuthGuard — runs BEFORE adminAuth on every admin route.
 *
 * Two allowed paths:
 *   1. req.internalUser is already set — the global adminAuth middleware verified
 *      a valid browser admin session. Session auth is always sufficient; no
 *      ADMIN_API_KEY header is required.
 *   2. ADMIN_API_KEY env var is configured — the route-level adminAuth that
 *      follows will validate the key from headers (server-to-server compat).
 *
 * Returns 503 only when NEITHER condition is true, i.e. no verified session AND
 * no API key is configured — which means adminAuth would fall through to its
 * dev-mode fail-open path and allow unauthenticated access.
 */
export function fashionDesignAuthGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Path 1: valid internal-user session set by the global adminAuth middleware.
  // This handles browser-based admin users — no API key needed.
  const internalUser = (req as unknown as Record<string, unknown>).internalUser;
  if (internalUser) {
    next();
    return;
  }

  // Path 2: ADMIN_API_KEY must be configured so that the route-level adminAuth
  // that follows can validate the key. Without it, adminAuth would fail-open in
  // dev — which is unacceptable for generation and mutation routes.
  const key = process.env["ADMIN_API_KEY"];
  const configured = Boolean(key && key.trim() !== "");

  if (!configured) {
    res.status(503).json({
      error: "Service Unavailable: authentication is not configured for this domain.",
      code: "AUTH_NOT_CONFIGURED",
    });
    return;
  }
  next();
}

/** Helper for tests / startup callers to check config state */
export function isAuthConfigured(): boolean {
  return Boolean(process.env["ADMIN_API_KEY"]?.trim());
}
