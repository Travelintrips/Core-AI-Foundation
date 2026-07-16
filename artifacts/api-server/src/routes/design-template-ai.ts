/**
 * Design Template AI — Routes (Phase 7)
 *
 * POST /ai/design-templates/ai-assist  → Generate template from prompt + save as draft
 * GET  /ai/design-templates/ai-assist/presets → Size presets list
 *
 * Route prefix rule: do NOT include /api here (mounted via app.ts → routes/index.ts).
 * All routes protected by global adminAuth middleware.
 * Never import zod/v4 directly — use validators/ schemas.
 */
import { Router } from "express";
import { resolveAuthenticatedTenantContext } from "../security/tenantResolution.js";
import { aiTemplateAssistRequestSchema } from "../validators/designTemplateAiSchema.js";
import { generateTemplateFromPrompt } from "../services/design-ai/templateAiService.js";
import { createTemplate, createVersion } from "../services/designTemplateService.js";
import { TenantAccessError } from "../services/designTemplateVariableService.js";
import { logger } from "../lib/logger.js";
import { DESIGN_TEMPLATE_SCHEMA_VERSION } from "../types/designTemplate.js";

const router = Router();

function actorId(req: Parameters<typeof resolveAuthenticatedTenantContext>[0]): string {
  return req.internalUser ? String(req.internalUser.id) : "system";
}

function handleError(res: any, err: unknown) {
  if (err instanceof TenantAccessError) return res.status(403).json({ error: "Access denied" });
  const msg = err instanceof Error ? err.message : "Unexpected error";
  logger.error({ err }, "[design-template-ai] Route error");
  return res.status(500).json({ error: msg });
}

/** GET /ai/design-templates/ai-assist/presets */
router.get("/ai/design-templates/ai-assist/presets", (_req, res) => {
  res.json({
    presets: [
      { id: "instagram-square",    label: "Instagram Square",    width: 1080, height: 1080 },
      { id: "instagram-portrait",  label: "Instagram Portrait",  width: 1080, height: 1350 },
      { id: "instagram-landscape", label: "Instagram Landscape", width: 1080, height: 566  },
      { id: "a4",                  label: "A4 Document",         width: 2480, height: 3508 },
      { id: "custom",              label: "Custom Size",         width: null,  height: null },
    ],
  });
});

/**
 * POST /ai/design-templates/ai-assist
 *
 * Body: AiTemplateAssistRequest
 * Response: { proposal, templateId, versionId, draftSaved }
 *
 * Always saves as draft status — editor opens /design-templates/:id/editor
 */
router.post("/ai/design-templates/ai-assist", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);
    const actor = actorId(req);

    const body = aiTemplateAssistRequestSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({
        error: "Validation failed",
        issues: body.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }

    // Generate + validate with AI
    const result = await generateTemplateFromPrompt(body.data, ctx.tenantId, actor);
    const { proposal } = result;

    // Build templateJson from proposal (draft only — no publish)
    const now = new Date().toISOString();
    const templateJson = {
      schemaVersion: DESIGN_TEMPLATE_SCHEMA_VERSION,
      id:            "pending", // replaced after DB insert
      tenantId:      ctx.tenantId,
      name:          proposal.template.name,
      description:   proposal.template.description,
      category:      proposal.template.category,
      canvas:        proposal.template.canvas,
      elements:      proposal.template.elements,
      variables:     proposal.variables,
      metadata: {
        createdBy: actor,
        createdAt: now,
        updatedAt: now,
        version:   1,
      },
    };

    // Save template as draft
    const template = await createTemplate({
      tenantId:    ctx.tenantId,
      name:        proposal.template.name,
      description: proposal.template.description,
      category:    proposal.template.category ?? "AI Generated",
      createdBy:   actor,
    });

    // Update id in templateJson now that we have the DB id
    (templateJson as any).id = String(template.id);

    // Create version (draft)
    const version = await createVersion({
      tenantId:     ctx.tenantId,
      templateId:   template.id,
      templateJson: templateJson as any,
      changelog:    `AI generated from prompt: "${body.data.prompt.slice(0, 100)}"`,
      createdBy:    actor,
    });

    logger.info(
      { templateId: template.id, versionId: version.id, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens },
      "[design-template-ai] Template generated and saved as draft",
    );

    res.status(201).json({
      proposal,
      templateId:  template.id,
      versionId:   version.id,
      draftSaved:  true,
      aiMeta: {
        provider:     result.provider,
        model:        result.model,
        inputTokens:  result.inputTokens,
        outputTokens: result.outputTokens,
      },
    });
  } catch (err) {
    return handleError(res, err);
  }
});

export default router;
