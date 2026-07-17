/**
 * authGuard.ts — Shared token-resolution helper for Team 2 routes.
 *
 * Delegates to the existing resolveWorkspaceSession (owned by core workspace team).
 * Never duplicates auth logic — just wraps it so Team 2 routes stay consistent.
 */
import type { Request, Response } from "express";
import {
  resolveWorkspaceSession,
  type WorkspaceSession,
} from "../customerWorkspaceService.js";

export type { WorkspaceSession };

/**
 * Resolve a workspace token from the request URL params.
 * Returns the session on success; writes a 401/404 response and returns null on failure.
 */
export async function guardToken(
  req: Request,
  res: Response,
): Promise<WorkspaceSession | null> {
  const { token } = req.params as { token: string };
  if (!token || typeof token !== "string" || token.length < 10) {
    res.status(400).json({ error: "Invalid workspace token" });
    return null;
  }
  const result = await resolveWorkspaceSession(token);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return null;
  }
  return result.session;
}

/**
 * Verify a projectNumber belongs to the authenticated session's email.
 * Uses the existing getProjectDetail which already enforces IDOR protection.
 */
export async function verifyProjectOwnership(
  req: Request,
  session: WorkspaceSession,
  projectNumber: string,
): Promise<import("../customerWorkspaceService.js").ProjectDetail | null> {
  const { getProjectDetail } = await import("../customerWorkspaceService.js");
  return getProjectDetail(req, session.clientEmail, projectNumber);
}
