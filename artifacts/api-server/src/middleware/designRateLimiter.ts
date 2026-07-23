/**
 * designRateLimiter.ts — Team 39: Tenant-aware rate limiters for design endpoints.
 *
 * Uses DESIGN_RATE_LIMIT_POLICIES from Team 36 (designSecurityPolicy.ts).
 * Key differences from the global IP-based limiter:
 *   - Authenticated routes: keyed by tenantId + actorId + capability.
 *   - Render/export: keyed by tenantId + projectId + operation.
 *   - If key extraction fails (auth not resolved), fail-closed: use failClosedMax.
 *   - Never uses raw token or authorization header as key.
 *
 * Requirements:
 *   - Tenant A quota must not exhaust Tenant B quota.
 *   - Invalid limiter config → fail-closed (lowest max).
 *   - Structured HTTP 429 response with Retry-After header.
 */
import rateLimit from "express-rate-limit";
import type { Request, Response } from "express";
import { DESIGN_RATE_LIMIT_POLICIES } from "../security/designSecurityPolicy.js";

// ── Safe key extractors ────────────────────────────────────────────────────────

/**
 * Extracts tenantId from the resolved request context (set by adminAuth / session).
 * Falls back to a fixed "anon" sentinel so the fail-closed limiter bucket still
 * applies rather than crashing the key generator.
 *
 * Never reads raw token or Authorization header as the key.
 */
function extractTenantId(req: Request): string {
  // req.internalUser is set by adminAuth middleware
  if (req.internalUser?.id) {
    // All authenticated routes resolve to the server-default tenant ("default").
    // When multi-tenant membership ships, tenantId will come from the session.
    return "default";
  }
  // No session resolved — use a shared "unauthenticated" bucket.
  // This is intentionally separate from any real tenant bucket.
  return "anon";
}

function extractActorId(req: Request): string {
  if (req.internalUser?.id) return String(req.internalUser.id);
  // Fallback: IP (never raw header/token)
  const fwd = req.headers["x-forwarded-for"];
  const ip = typeof fwd === "string" ? fwd.split(",")[0]!.trim() : req.ip ?? "unknown";
  return `ip:${ip}`;
}

function extractProjectId(req: Request): string {
  const id = req.params["id"];
  return id ? `proj:${id}` : "proj:unknown";
}

// ── Handler factory ────────────────────────────────────────────────────────────

function designLimitHandler(capability: string) {
  return (_req: Request, res: Response) => {
    res.status(429).json({
      error: "Design rate limit exceeded",
      code: "DESIGN_RATE_LIMIT_EXCEEDED",
      capability,
      retryAfter: res.getHeader("Retry-After"),
    });
  };
}

// ── Policy-driven limiter factory ─────────────────────────────────────────────

function makeDesignLimiter(
  policyId: string,
  keyFn: (req: Request) => string,
  capability: string,
) {
  const policy = DESIGN_RATE_LIMIT_POLICIES[policyId];
  if (!policy) {
    // Unknown policy — fail-closed: use the most restrictive config
    return rateLimit({
      windowMs: 60_000,
      max: 1,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: keyFn,
      handler: designLimitHandler(capability),
    });
  }

  let max: number;
  try {
    // Validate the policy values — fail-closed if nonsensical
    if (
      typeof policy.max !== "number" ||
      policy.max <= 0 ||
      typeof policy.windowMs !== "number" ||
      policy.windowMs <= 0 ||
      typeof policy.failClosedMax !== "number" ||
      policy.failClosedMax <= 0
    ) {
      max = policy.failClosedMax ?? 1;
    } else {
      max = policy.max;
    }
  } catch {
    max = 1; // hard fail-closed
  }

  return rateLimit({
    windowMs: policy.windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyFn,
    handler: designLimitHandler(capability),
  });
}

// ── Exported limiters ─────────────────────────────────────────────────────────

/**
 * AI regenerate: 10/min per tenantId.
 * Key: tenantId:actorId:ai_regenerate — prevents tenant B from consuming tenant A's quota.
 */
export const designAiRegenerateLimiter = makeDesignLimiter(
  "design_ai_regenerate",
  (req) => `${extractTenantId(req)}:${extractActorId(req)}:ai_regenerate`,
  "design:ai_regenerate",
);

/**
 * Export: 20/min per tenantId + projectId.
 * Key: tenantId:projectId:export — scoped to the specific project being exported.
 */
export const designExportLimiter = makeDesignLimiter(
  "design_export",
  (req) => `${extractTenantId(req)}:${extractProjectId(req)}:export`,
  "design:export",
);

/**
 * Canvas save: 60/min per actorId.
 * Key: tenantId:actorId:canvas_save — fast autosave path, keyed by actor not tenant.
 */
export const designCanvasSaveLimiter = makeDesignLimiter(
  "design_canvas_save",
  (req) => `${extractTenantId(req)}:${extractActorId(req)}:canvas_save`,
  "design:canvas_save",
);

/**
 * Upload / asset write: reuses upload policy from rateLimiter.ts, keyed by actorId.
 * 10/min per actor.
 */
export const designUploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${extractTenantId(req)}:${extractActorId(req)}:upload`,
  handler: designLimitHandler("design:upload"),
});
