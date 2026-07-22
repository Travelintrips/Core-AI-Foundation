/**
 * design-quality.ts — Team 33
 *
 * Routes for the Universal Design Quality Assurance Engine.
 *
 * Mount path (added by app.ts router prefix): /ai/design-quality
 *
 * Endpoints:
 *   POST /ai/design-quality/evaluate          — evaluate a design artifact
 *   GET  /ai/design-quality/rules             — list all registered rules
 *   GET  /ai/design-quality/rules/:ruleId     — get a specific rule by ID
 *
 * Auth:
 *   All endpoints use adminAuthWithExceptions (admin-key gating).
 *   No route on this path is declared public.
 */

import { Router } from "express";
import { z } from "zod";
import { adminAuthWithExceptions } from "../middleware/adminAuth.js";
import {
  globalDesignQualityRegistry,
  designQualityEvaluator,
  ALL_CATEGORIES,
} from "../services/design-quality/index.js";
import type { DesignQualityCheckRequest, DesignQualityCategory } from "../services/design-quality/types.js";

export const designQualityRouter = Router();

// Apply admin auth to all routes on this router
designQualityRouter.use(adminAuthWithExceptions);

// ── Validation schemas ────────────────────────────────────────────────────────

const categoryEnum = ALL_CATEGORIES as unknown as [string, ...string[]];

const EvaluateRequestSchema = z.object({
  artifactType:          z.string().min(1).max(100),
  artifactId:            z.string().max(200).nullish(),
  tenantId:              z.string().max(200).nullish(),
  context:               z.record(z.unknown()),
  enabledCategories:     z.array(z.enum(categoryEnum)).nullish(),
  aiAssistEnabled:       z.boolean().optional().default(false),
  availableCapabilities: z.array(z.string()).nullish(),
  // Plugin rule sets: for evaluation-time rule injection only.
  // These are DesignQualityRuleSet shapes (no evaluators — they contribute
  // metadata only through this HTTP endpoint; BoundRule evaluators require
  // in-process registration via the SDK).
  pluginRuleSets: z
    .array(
      z.object({
        id:      z.string(),
        name:    z.string(),
        version: z.string(),
        source:  z.enum(["core", "workflow", "plugin", "export_format", "organization_policy", "brand_policy"]),
        rules:   z.array(
          z.object({
            id:                  z.string(),
            version:             z.string(),
            name:                z.string(),
            description:         z.string(),
            category:            z.enum(categoryEnum),
            severity:            z.enum(["info", "warning", "error", "blocking"]),
            source:              z.enum(["core", "workflow", "plugin", "export_format", "organization_policy", "brand_policy"]),
            capabilityRequirement: z.string().nullish(),
            applicableTo:        z.array(z.string()).nullish(),
            autoFixable:         z.boolean(),
            sourceAttribution:   z.string(),
          })
        ),
      })
    )
    .nullish(),
});

// ── POST /ai/design-quality/evaluate ─────────────────────────────────────────

designQualityRouter.post("/ai/design-quality/evaluate", async (req, res) => {
  const parsed = EvaluateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({
      error: "Invalid request body",
      details: parsed.error.flatten(),
    });
  }

  const data = parsed.data;

  const request: DesignQualityCheckRequest = {
    artifactType:          data.artifactType,
    artifactId:            data.artifactId ?? null,
    tenantId:              data.tenantId ?? null,
    context:               data.context,
    enabledCategories:     (data.enabledCategories as DesignQualityCategory[] | null) ?? null,
    aiAssistEnabled:       data.aiAssistEnabled,
    availableCapabilities: data.availableCapabilities ?? null,
    pluginRuleSets:        data.pluginRuleSets
      ? data.pluginRuleSets.map((ps) => ({
          ...ps,
          source: ps.source,
          rules:  ps.rules.map((r) => ({
            ...r,
            category:              r.category as DesignQualityCategory,
            severity:              r.severity as "info" | "warning" | "error" | "blocking",
            capabilityRequirement: r.capabilityRequirement ?? null,
            applicableTo:          r.applicableTo ?? null,
          })),
        }))
      : null,
  };

  try {
    const result = await designQualityEvaluator.evaluate(request);
    return res.status(200).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error during quality evaluation";
    return res.status(500).json({ error: message });
  }
});

// ── GET /ai/design-quality/rules ─────────────────────────────────────────────

designQualityRouter.get("/ai/design-quality/rules", (_req, res) => {
  const rules = globalDesignQualityRegistry.listRules();
  return res.status(200).json({
    count: rules.length,
    rules,
  });
});

// ── GET /ai/design-quality/rules/:ruleId ─────────────────────────────────────

designQualityRouter.get("/ai/design-quality/rules/:ruleId", (req, res) => {
  const ruleId = req.params["ruleId"];
  if (!ruleId) {
    return res.status(400).json({ error: "ruleId is required" });
  }

  const bound = globalDesignQualityRegistry.getRule(ruleId);
  if (!bound) {
    return res.status(404).json({ error: `Rule "${ruleId}" not found` });
  }

  return res.status(200).json(bound.rule);
});
