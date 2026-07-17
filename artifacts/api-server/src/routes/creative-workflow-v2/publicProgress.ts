/**
 * creative-workflow-v2 — Public Execution Progress (IDOR-safe)
 *
 * This router provides a single public endpoint for customers to poll the
 * progress of their own execution plans WITHOUT admin credentials.
 *
 * IDOR safety contract:
 *   - The caller supplies an opaque contextToken (issued by the platform).
 *   - contextToken is resolved SERVER-SIDE to { contextId, contextType }.
 *   - Plans are fetched by the resolved contextId — never from the request URL/body.
 *   - An unknown/expired token always returns 401 (fail-closed).
 *   - A plan belonging to a different contextId is NEVER returned.
 *
 * Mount instructions for Team 24:
 *   This router must be mounted BEFORE adminAuthWithExceptions, OR the path
 *   /api/ai/creative-workflow/v2/public/progress must be added to
 *   PUBLIC_PATH_PREFIXES in middleware/adminAuth.ts so it is not blocked
 *   by the admin key check.
 *
 *   Recommended:
 *     app.get(
 *       "/api/ai/creative-workflow/v2/public/progress",
 *       creativeWorkflowV2PublicProgressHandler   // exported below
 *     );
 *   i.e. mount as an isolated path-specific route that runs before
 *   adminAuthWithExceptions.
 *
 * TEAM 1 OWNED — do not modify outside feature/01-creative-workflow.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { calculateProgress } from "../../services/creative-workflow-v2/index.js";
import type { ExecutionPlan } from "../../types/creative-workflow-v2/index.js";

export const publicProgressRouter = Router();

// ── Resolved context shape ────────────────────────────────────────────────────

export interface ResolvedContext {
  /** Server-resolved context identifier (e.g. creative_project UUID). */
  contextId: string;
  /** Discriminator for the context entity (e.g. "creative_project"). */
  contextType: string;
}

// ── Injection hooks ───────────────────────────────────────────────────────────

/**
 * Resolves an opaque context token → { contextId, contextType }.
 * Returns null/undefined for invalid, expired, or unknown tokens.
 *
 * Default: fail-closed (returns null for every token).
 * Team 24 must call setContextTokenResolver() to enable this endpoint.
 */
type ContextTokenResolver = (token: string) => ResolvedContext | null | undefined;
let _contextTokenResolver: ContextTokenResolver = () => null;

export function setContextTokenResolver(fn: ContextTokenResolver): void {
  _contextTokenResolver = fn;
}

/**
 * Returns all ExecutionPlans for a given contextId.
 * Used by the public progress endpoint to find plans after token resolution.
 *
 * Default: returns empty array (no plans visible until Team 24 wires the store).
 * The function MUST filter by contextId — returning all plans regardless of
 * contextId would be an IDOR vulnerability.
 */
type PlanReader = (contextId: string) => ExecutionPlan[];
let _planReader: PlanReader = () => [];

export function setPublicPlanReader(fn: PlanReader): void {
  _planReader = fn;
}

// ── GET /public/progress?token=<contextToken> ─────────────────────────────────

/**
 * Returns a progress summary for all execution plans belonging to the
 * context identified by the supplied token.
 *
 * Query params:
 *   token — required; opaque context access token (issued by the platform)
 *
 * Responses:
 *   200 — { data: { contextId, contextType, plans: [...] } }
 *   401 — token missing, invalid, or expired
 */
publicProgressRouter.get("/public/progress", (req: Request, res: Response) => {
  const token = (req.query["token"] as string | undefined)?.trim();

  // Fail closed: token is required
  if (!token) {
    res.status(401).json({ error: "Unauthorized: context token is required" });
    return;
  }

  // Resolve token server-side — NEVER accept contextId from request
  const context = _contextTokenResolver(token);
  if (!context || !context.contextId) {
    res.status(401).json({ error: "Unauthorized: invalid or expired context token" });
    return;
  }

  // Fetch only plans for the server-resolved contextId (IDOR-safe)
  const plans = _planReader(context.contextId);

  const planSummaries = plans.map((p) => ({
    planId:               p.id,
    workflowDefinitionId: p.workflowDefinitionId,
    contextType:          p.contextType,
    status:               p.status,
    progress:             calculateProgress(p.nodes),
    createdAt:            p.createdAt,
    updatedAt:            p.updatedAt,
  }));

  res.json({
    data: {
      contextId:   context.contextId,
      contextType: context.contextType,
      plans:       planSummaries,
    },
  });
});
