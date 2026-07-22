/**
 * Team 28 — Furniture & Product Design Plugin — Auth Guard
 *
 * Runs BEFORE adminAuth on all admin-protected routes.
 * Returns 503 if ADMIN_API_KEY is not configured — never fail-open.
 * (Same pattern as fashionDesignAuthGuard, Team 18.)
 *
 * TEAM 28 OWNED — do not modify outside feature/team-28-product-design-plugin.
 */

import type { Request, Response, NextFunction } from "express";

export function productDesignPluginAuthGuard(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!process.env["ADMIN_API_KEY"]) {
    res.status(503).json({
      error: "Service not available: ADMIN_API_KEY not configured.",
      code: "AUTH_NOT_CONFIGURED",
    });
    return;
  }
  next();
}
