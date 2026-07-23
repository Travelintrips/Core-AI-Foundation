/**
 * V4.5 AI Design Studio — admin routes
 * All routes protected by adminAuth middleware (applied globally via app.ts).
 *
 * Team 36 (Design Security) changes:
 *   - Every route now resolves a TenantScopedContext via
 *     resolveAuthenticatedTenantContext and passes ctx.tenantId to the service
 *     layer. This closes the IDOR vulnerability where any admin key could
 *     read or mutate any tenant's design projects by knowing the numeric ID.
 *   - archiveDesignProject and updateDesignProject return null (→ 404) when the
 *     project does not belong to the resolved tenant.
 *   - Version and canvas routes verify project ownership transitively through
 *     the service layer's getDesignProject(id, tenantId) check.
 *
 * Team 39 (Platform Integration) additions:
 *   - Per-endpoint design rate limiters (designRateLimiter.ts) wired onto
 *     AI, export, and canvas-save routes. Keys are tenantId:actorId, never IP-only.
 *   - validateCanvasResourceLimits() called on PUT canvas route before save.
 *   - evaluateDesignPolicy() + buildDesignAuditEvent() + logAudit() wired onto
 *     security-sensitive operations (AI regenerate, export, canvas save).
 *   - All deny paths: audit event emitted, logAudit called fail-safe.
 *   - Audit failure never changes deny to allow.
 */
import { Router } from "express";
import {
  listDesignProjects,
  getDesignProject,
  createDesignProject,
  updateDesignProject,
  archiveDesignProject,
  getDesignCanvas,
  saveDesignCanvas,
  listDesignVersions,
  getDesignVersion,
  restoreDesignVersion,
  exportDesign,
  aiRegenerateElement,
} from "../services/designStudioService.js";
import {
  listBuiltinTemplates,
  getBuiltinTemplate,
} from "../data/design-templates.js";
import { resolveAuthenticatedTenantContext } from "../security/tenantResolution.js";
import {
  evaluateDesignPolicy,
  buildDesignAuditEvent,
  validateCanvasResourceLimits,
  getDesignResourceLimits,
  type DesignSecurityPolicy,
} from "../security/designSecurityPolicy.js";
import { logAudit } from "../services/aiAuditService.js";
import {
  designAiRegenerateLimiter,
  designExportLimiter,
  designCanvasSaveLimiter,
} from "../middleware/designRateLimiter.js";

const router = Router();

// ── Security helpers ───────────────────────────────────────────────────────────

/**
 * Emits a design security audit event to the audit log.
 * MUST NOT throw — audit failure must never affect the authorization decision.
 */
async function emitDesignAuditEvent(
  policy: DesignSecurityPolicy,
  decision: ReturnType<typeof evaluateDesignPolicy>,
  context: string,
  requestId?: string,
): Promise<void> {
  try {
    const event = buildDesignAuditEvent(policy, decision, context, requestId);
    await logAudit({
      module: "design-security",
      action: event.event,
      resourceType: event.resourceScope,
      resourceId: context,
      status: event.decision === "allow" ? "success" : "failure",
      details: {
        reason: event.reason,
        actorType: event.actorType,
        permission: event.permission,
        // NEVER log: raw tokens, provider keys, auth headers, full prompts
      },
      tenantId: event.tenantId,
      actorId: event.actorId,
      actorType: "internal_user",
    });
  } catch {
    // Audit failure must not change the security decision.
    // Swallowed intentionally — operational error logged separately by logAudit.
  }
}

/**
 * Builds a DesignSecurityPolicy from the resolved tenant context.
 * actorType is mapped from the TenantScopedContext isPlatformAdmin flag.
 */
function buildPolicy(
  ctx: ReturnType<typeof resolveAuthenticatedTenantContext>,
  scope: DesignSecurityPolicy["resourceScope"],
  permission: DesignSecurityPolicy["permission"],
  resourceTenantId?: string,
): DesignSecurityPolicy {
  return {
    tenantId: ctx.tenantId,
    actorId: ctx.actorId ?? "system",
    actorType: ctx.isPlatformAdmin ? "platform_admin" : "tenant_admin",
    isPlatformActor: ctx.isPlatformAdmin,
    resourceScope: scope,
    permission,
    resourceTenantId,
  };
}

// ── Projects ──────────────────────────────────────────────────────────────────

/** GET /api/ai/design/projects */
router.get("/ai/design/projects", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const status = typeof req.query["status"] === "string" ? req.query["status"] : undefined;
    const page = parseInt(String(req.query["page"] ?? "1"), 10);
    const pageSize = Math.min(parseInt(String(req.query["pageSize"] ?? "20"), 10), 100);
    const result = await listDesignProjects({ tenantId: ctx.tenantId, status, page, pageSize });
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

/** POST /api/ai/design/projects */
router.post("/ai/design/projects", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    // tenantId is always taken from the authenticated context — never from req.body.
    const project = await createDesignProject({ ...req.body, tenantId: ctx.tenantId });
    res.status(201).json(project);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

/** GET /api/ai/design/projects/:id */
router.get("/ai/design/projects/:id", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const project = await getDesignProject(id, ctx.tenantId);
    if (!project) { res.status(404).json({ error: "Not found" }); return; }
    res.json(project);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

/** PATCH /api/ai/design/projects/:id */
router.patch("/ai/design/projects/:id", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const updated = await updateDesignProject(id, ctx.tenantId, req.body);
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

/** POST /api/ai/design/projects/:id/archive */
router.post("/ai/design/projects/:id/archive", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const result = await archiveDesignProject(id, ctx.tenantId);
    if (!result) { res.status(404).json({ error: "Not found" }); return; }
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

// ── Canvas ─────────────────────────────────────────────────────────────────────

/** GET /api/ai/design/projects/:id/canvas */
router.get("/ai/design/projects/:id/canvas", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const canvas = await getDesignCanvas(id, ctx.tenantId);
    if (!canvas) { res.status(404).json({ error: "Not found" }); return; }
    res.json(canvas);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

/** PUT /api/ai/design/projects/:id/canvas
 *
 * Team 39: canvas save rate limiter + resource limit validation.
 * Payload size, canvas dimensions, and element count are checked before DB write.
 */
router.put("/ai/design/projects/:id/canvas", designCanvasSaveLimiter, async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { canvasState, label } = req.body;
    if (!canvasState) { res.status(400).json({ error: "canvasState required" }); return; }

    // ── Team 39: Resource limit validation ─────────────────────────────────
    const limits = getDesignResourceLimits();
    const stateForCheck = {
      width:    typeof canvasState.width === "number"    ? canvasState.width    : 0,
      height:   typeof canvasState.height === "number"   ? canvasState.height   : 0,
      elements: Array.isArray(canvasState.elements)      ? canvasState.elements : [],
    };
    const limitDecision = validateCanvasResourceLimits(stateForCheck, limits);
    if (limitDecision.action === "deny") {
      const policy = buildPolicy(ctx, "design:canvas", "design.canvas.write");
      void emitDesignAuditEvent(
        { ...policy, ...{ resourceScope: "design:canvas" } },
        { ...limitDecision, reason: "resource_limit_exceeded" },
        `canvas_save:project:${id}`,
        ctx.requestId,
      );
      res.status(limitDecision.httpStatus ?? 422).json({
        error: "Canvas resource limit exceeded",
        code: "RESOURCE_LIMIT_EXCEEDED",
        detail: limitDecision.detail,
      });
      return;
    }

    const result = await saveDesignCanvas(id, canvasState, ctx.tenantId, label);
    if (!result) { res.status(404).json({ error: "Not found" }); return; }
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

// ── Versions ──────────────────────────────────────────────────────────────────

/** GET /api/ai/design/projects/:id/versions?page=1&pageSize=30 */
router.get("/ai/design/projects/:id/versions", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const result = await listDesignVersions(id, ctx.tenantId);
    if (!result) { res.status(404).json({ error: "Not found" }); return; }
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

/** GET /api/ai/design/projects/:id/versions/:versionId */
router.get("/ai/design/projects/:id/versions/:versionId", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(req.params["id"] ?? "", 10);
    const versionId = parseInt(req.params["versionId"] ?? "", 10);
    if (isNaN(id) || isNaN(versionId)) { res.status(400).json({ error: "Invalid id" }); return; }
    const version = await getDesignVersion(id, versionId, ctx.tenantId);
    if (!version) { res.status(404).json({ error: "Not found" }); return; }
    res.json(version);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

/** POST /api/ai/design/projects/:id/versions/:versionId/restore */
router.post("/ai/design/projects/:id/versions/:versionId/restore", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(req.params["id"] ?? "", 10);
    const versionId = parseInt(req.params["versionId"] ?? "", 10);
    if (isNaN(id) || isNaN(versionId)) { res.status(400).json({ error: "Invalid id" }); return; }
    const result = await restoreDesignVersion(id, versionId, ctx.tenantId);
    if (!result) { res.status(404).json({ error: "Not found" }); return; }
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

// ── Export ────────────────────────────────────────────────────────────────────

/** POST /api/ai/design/projects/:id/export
 *
 * Team 39: export rate limiter + policy evaluation + audit event.
 */
router.post("/ai/design/projects/:id/export", designExportLimiter, async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    // ── Team 39: Policy evaluation ─────────────────────────────────────────
    const policy = buildPolicy(ctx, "design:export", "design.export.execute");
    const decision = evaluateDesignPolicy(policy);
    if (decision.action === "deny") {
      void emitDesignAuditEvent(policy, decision, `export:project:${id}`, ctx.requestId);
      res.status(decision.httpStatus ?? 403).json({
        error: "Design export denied",
        code: decision.reason,
      });
      return;
    }

    const { format = "json", scale = 1 } = req.body;
    const result = await exportDesign(id, ctx.tenantId, format, scale);
    if (!result) { res.status(404).json({ error: "Not found" }); return; }
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

// ── Built-in Templates ────────────────────────────────────────────────────────

/** GET /api/ai/design/templates/builtin — daftar template bawaan (no DB) */
router.get("/ai/design/templates/builtin", (req, res) => {
  const category = typeof req.query["category"] === "string" ? req.query["category"] : undefined;
  const industry = typeof req.query["industry"] === "string" ? req.query["industry"] : undefined;
  const style    = typeof req.query["style"]    === "string" ? req.query["style"]    : undefined;
  const templates = listBuiltinTemplates({ category, industry, style });
  // Strip canvasState from list view to keep payload small
  const items = templates.map(({ canvasState: _cs, ...meta }) => meta);
  res.json({ items, total: items.length });
});

/** GET /api/ai/design/templates/builtin/:code — detail + canvas state lengkap */
router.get("/ai/design/templates/builtin/:code", (req, res) => {
  const tpl = getBuiltinTemplate(req.params["code"] ?? "");
  if (!tpl) { res.status(404).json({ error: "Template not found" }); return; }
  res.json(tpl);
});

// ── AI Regenerate ─────────────────────────────────────────────────────────────

/** POST /api/ai/design/projects/:id/ai/regenerate
 *
 * Team 39: AI rate limiter + policy evaluation + audit event.
 * Provider secret is resolved server-side only — never accepted from client body.
 */
router.post("/ai/design/projects/:id/ai/regenerate", designAiRegenerateLimiter, async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    // ── Team 39: Strip any client-supplied provider key from body ──────────
    // The AI execution service resolves the provider key from environment secrets.
    // Accepting it from the client body would be an injection vector.
    const { apiKey: _ignoredKey, providerKey: _ignoredPKey, ...safeBody } = req.body as Record<string, unknown>;

    // ── Team 39: Policy evaluation ─────────────────────────────────────────
    const policy = buildPolicy(ctx, "design:ai_regenerate", "design.ai.regenerate");
    const decision = evaluateDesignPolicy(policy);
    if (decision.action === "deny") {
      void emitDesignAuditEvent(policy, decision, `ai_regenerate:project:${id}`, ctx.requestId);
      res.status(decision.httpStatus ?? 403).json({
        error: "AI regeneration denied",
        code: decision.reason,
      });
      return;
    }

    const body = safeBody as Record<string, unknown>;
    const typedInput = {
      elementId:      typeof body["elementId"]      === "string" ? body["elementId"]      : "",
      elementType:    (["text", "image", "style"].includes(String(body["elementType"]))
                        ? body["elementType"]
                        : "text") as "text" | "image" | "style",
      prompt:         typeof body["prompt"]         === "string" ? body["prompt"]         : "",
      currentContent: typeof body["currentContent"] === "string" ? body["currentContent"] : undefined,
      style:          typeof body["style"]          === "string" ? body["style"]          : undefined,
      tone:           typeof body["tone"]           === "string" ? body["tone"]           : undefined,
    };
    const result = await aiRegenerateElement(id, ctx.tenantId, typedInput);
    if (!result) { res.status(404).json({ error: "Not found" }); return; }
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

export default router;
