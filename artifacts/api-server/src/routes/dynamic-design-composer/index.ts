/**
 * Team 13 — Dynamic Design Composition Engine
 * Route handlers
 *
 * Base path (after /api prefix from app.ts):
 *   POST   /ai/composer/compose                — compose a DesignCompositionSpec
 *   POST   /ai/composer/validate               — validate inputs without composing
 *   POST   /ai/composer/compatibility          — check compatibility of design elements
 *   GET    /ai/composer/sessions/:key          — get session by idempotency key (tenant-scoped)
 *   GET    /ai/composer/health                 — route-level health probe
 *
 * Auth:
 *   All routes (except /health) are protected by the global adminAuth middleware in app.ts.
 *   No per-route auth setup required.
 *
 * Tenant scoping:
 *   When idempotencyKey is provided, tenantId must also be provided in the request body.
 *   Session lookups are strictly scoped by tenantId — cross-tenant lookups return 404.
 *
 * Rules:
 *   - No zod/v4 direct imports — schemas live in the service layer only.
 *   - No layout solving — Team 13 receives LayoutPlanInput from Team 12 verbatim.
 */

import { Router, type Request, type Response } from "express";
import { ZodError } from "zod";
import {
  compose,
  checkCompatibility,
  compositionRequestSchema,
  validateRequestSchema,
  compatibilityCheckSchema,
  guardCompositionState,
  getSession,
  createSession,
  transitionSession,
} from "../../services/dynamic-design-composer/index.js";
import { applyFallbacks } from "../../services/dynamic-design-composer/fallbackHandler.js";
import { logger } from "../../lib/logger.js";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatZodError(err: ZodError): string {
  return err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
}

/**
 * Extract the tenantId for session scoping.
 * Prefers the X-Tenant-Id header (cannot be spoofed by a body payload).
 * Falls back to req.body.tenantId for backward compatibility with admin callers
 * that embed tenantId in the request body.
 *
 * NEVER use tenantId from body as source of truth for access control decisions —
 * only for scoping composition context when the admin explicitly sets it.
 */
function resolveTenantId(req: Request): string | undefined {
  const fromHeader = req.headers["x-tenant-id"];
  if (fromHeader && typeof fromHeader === "string" && fromHeader.trim()) {
    return fromHeader.trim();
  }
  const fromBody = req.body?.tenantId;
  if (fromBody && typeof fromBody === "string" && fromBody.trim()) {
    return fromBody.trim();
  }
  return undefined;
}

// ── POST /api/ai/composer/compose ─────────────────────────────────────────────

/**
 * Compose a full DesignCompositionSpec from the provided design elements.
 *
 * Idempotency:
 *   If idempotencyKey + tenantId are provided:
 *   - completed  → return existing spec (no reprocess)
 *   - failed     → blocked unless allowRetry=true
 *   - cancelled  → blocked (create new request)
 *   - processing → blocked (409)
 *   - pending    → proceed
 *
 * Body: CompositionRequest
 * Response: DesignCompositionSpec
 */
router.post("/ai/composer/compose", async (req: Request, res: Response) => {
  try {
    const parseResult = compositionRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: "Invalid composition request",
        details: formatZodError(parseResult.error),
      });
      return;
    }

    const data = parseResult.data;
    const tenantId = resolveTenantId(req);

    // ── Idempotency + terminal-state guard ────────────────────────────────────

    if (data.idempotencyKey) {
      if (!tenantId) {
        res.status(400).json({
          error: "tenantId is required (in body or X-Tenant-Id header) when idempotencyKey is provided",
        });
        return;
      }

      const existingSession = getSession(tenantId, data.idempotencyKey);
      if (existingSession) {
        const guardError = guardCompositionState(existingSession, data.allowRetry ?? false);

        if (guardError) {
          switch (guardError.code) {
            case "ALREADY_COMPLETED":
              // Idempotent return — same input, same result
              logger.info(
                { tenantId, idempotencyKey: data.idempotencyKey, compositionId: guardError.existingResult.compositionId },
                "[composer] Returning cached completed composition (idempotent)",
              );
              res.status(200).json({ ...guardError.existingResult, idempotent: true });
              return;

            case "CANCELLED":
              res.status(409).json({
                error: guardError.message,
                state: "cancelled",
                code: "CANCELLED",
              });
              return;

            case "FAILED_NO_RETRY":
              res.status(409).json({
                error: guardError.message,
                state: "failed",
                code: "FAILED_NO_RETRY",
                failureReason: guardError.failureReason,
              });
              return;

            case "IN_PROGRESS":
              res.status(409).json({
                error: guardError.message,
                state: "processing",
                code: "IN_PROGRESS",
              });
              return;
          }
        }

        // Retry path: failed → pending (guardCompositionState returned null with allowRetry=true)
        if (existingSession.state === "failed") {
          transitionSession(tenantId, data.idempotencyKey, "pending");
          logger.info(
            { tenantId, idempotencyKey: data.idempotencyKey },
            "[composer] Retrying failed session — transitioned to pending",
          );
        }
      } else {
        // First execution — create session in pending state
        createSession(tenantId, data.idempotencyKey);
      }

      // Mark as processing before computation starts
      transitionSession(tenantId, data.idempotencyKey, "processing");
    }

    // ── Compose ───────────────────────────────────────────────────────────────

    let spec;
    try {
      spec = compose(data);
    } catch (composeErr) {
      // On failure, transition session to failed if tracking
      if (data.idempotencyKey && tenantId) {
        const reason = composeErr instanceof Error ? composeErr.message : "Unknown error";
        try {
          transitionSession(tenantId, data.idempotencyKey, "failed", { failureReason: reason });
        } catch (_e) {
          // Session transition failure is non-fatal — log and continue
          logger.warn({ tenantId, idempotencyKey: data.idempotencyKey }, "[composer] Failed to transition session to failed");
        }
      }
      throw composeErr;
    }

    // ── Mark completed ────────────────────────────────────────────────────────

    if (data.idempotencyKey && tenantId) {
      transitionSession(tenantId, data.idempotencyKey, "completed", { result: spec });
    }

    logger.info(
      {
        compositionId: spec.compositionId,
        styleScore: spec.styleConsistencyScore,
        brandScore: spec.brandConsistencyScore,
        fallbackCount: spec.fallbacksApplied.length,
        componentCount: spec.components.length,
        tenantId,
        idempotencyKey: data.idempotencyKey,
      },
      "[composer] Composition complete",
    );

    res.status(200).json(spec);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unexpected error";
    logger.error({ err }, "[composer] Composition failed");
    res.status(500).json({ error: msg });
  }
});

// ── POST /api/ai/composer/validate ────────────────────────────────────────────

/**
 * Validate a CompositionRequest without running the full composition.
 * Returns validation errors and a preview of what fallbacks would be applied.
 *
 * Body: CompositionRequest
 * Response: { valid: boolean; errors?: string; fallbackPreview: FallbackRecord[] }
 */
router.post("/ai/composer/validate", async (req: Request, res: Response) => {
  try {
    const parseResult = validateRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(200).json({
        valid: false,
        errors: formatZodError(parseResult.error),
        fallbackPreview: [],
      });
      return;
    }

    const data = parseResult.data;

    // Run fallback analysis to show what the engine would fill in
    const fallbackResult = applyFallbacks(
      data.blueprint,
      data.layoutPlan,
      data.components,
      data.pattern,
      data.palette,
      data.typography,
      data.decoration,
      data.material,
      data.motif,
      data.brandDna,
    );

    res.status(200).json({
      valid: true,
      errors: null,
      fallbackPreview: fallbackResult.fallbacks,
      summary: {
        blueprintProvided: !!data.blueprint,
        layoutProvided: !!data.layoutPlan,
        paletteProvided: !!data.palette,
        typographyProvided: !!data.typography,
        componentCount: data.components.length,
        brandDnaProvided: !!data.brandDna,
        hasBrandColors: !!data.brandDna?.detectedColors?.primary,
        fallbackCount: fallbackResult.fallbacks.length,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unexpected error";
    res.status(500).json({ error: msg });
  }
});

// ── POST /api/ai/composer/compatibility ───────────────────────────────────────

/**
 * Check cross-element compatibility without a full composition.
 * Useful for real-time UI feedback while building a composition request.
 *
 * Body: { material, pattern, palette, decoration }
 * Response: CompatibilityReport
 */
router.post("/ai/composer/compatibility", async (req: Request, res: Response) => {
  try {
    const parseResult = compatibilityCheckSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: "Invalid compatibility check request",
        details: formatZodError(parseResult.error),
      });
      return;
    }

    const { material, pattern, palette, decoration } = parseResult.data;

    const report = checkCompatibility({
      material,
      pattern,
      palette,
      decoration,
      layout: {
        name: "check",
        strategy: "hero-content",
        flow: "vertical",
        heroWeight: 0.4,
        sectionCount: 3,
        hasSidebar: false,
        emphasis: "balanced",
      },
      components: [],
      typography: {
        name: "check",
        headingFont: "Inter",
        bodyFont: "Inter",
        headingWeight: "600",
        bodyWeight: "400",
        baseSize: 16,
        scaleRatio: 1.25,
        lineHeight: 1.6,
        letterSpacing: "normal",
        style: "sans-serif",
      },
    });

    res.status(200).json(report);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unexpected error";
    res.status(500).json({ error: msg });
  }
});

// ── GET /api/ai/composer/sessions/:key ────────────────────────────────────────

/**
 * Get a composition session by idempotency key.
 *
 * IDOR protection: tenantId is required (from X-Tenant-Id header or body).
 * Cross-tenant lookups return 404 — identical to "not found" to avoid
 * leaking session existence across tenants.
 *
 * Params: :key — the idempotencyKey
 * Headers: X-Tenant-Id (preferred) or body.tenantId
 * Response: CompositionSession (result omitted for failed/cancelled states)
 */
router.get("/ai/composer/sessions/:key", (req: Request, res: Response) => {
  const idempotencyKey = req.params.key;
  if (!idempotencyKey) {
    res.status(400).json({ error: "idempotencyKey param is required" });
    return;
  }

  // Tenant is resolved from header first — never trust a body param for ownership
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    res.status(400).json({
      error: "tenantId is required (X-Tenant-Id header or body.tenantId) for session lookup",
    });
    return;
  }

  const session = getSession(tenantId, idempotencyKey);
  if (!session) {
    // Return 404 for both "not found" and "wrong tenant" — don't leak existence
    res.status(404).json({ error: "Session not found" });
    return;
  }

  // Return session with state. Strip result payload for non-completed states
  // to avoid returning partial/corrupt data.
  const safeSession = {
    sessionId: session.sessionId,
    tenantId: session.tenantId,
    idempotencyKey: session.idempotencyKey,
    state: session.state,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    ...(session.state === "completed" ? { result: session.result } : {}),
    ...(session.state === "failed" ? { failureReason: session.failureReason } : {}),
  };

  res.status(200).json(safeSession);
});

// ── GET /api/ai/composer/health ───────────────────────────────────────────────

router.get("/ai/composer/health", (_req, res) => {
  res.status(200).json({
    service: "dynamic-design-composer",
    team: "team-13",
    version: "1.0.0",
    status: "ok",
  });
});

export default router;
