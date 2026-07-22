/**
 * design-cost-attribution.ts — Team 34: Design Cost, Usage, and Budget Attribution
 *
 * All routes are admin-key protected (via the global adminAuthWithExceptions middleware).
 * Tenant is always resolved server-side via resolveAuthenticatedTenantContext — never
 * from client-supplied input.
 *
 * Route prefix: /ai/design-cost  (mounted without /api prefix — route files omit it)
 *
 * Endpoints:
 *   POST   /ai/design-cost/attribution              — record one attribution
 *   GET    /ai/design-cost/attribution/:jobId        — get by jobId
 *   GET    /ai/design-cost/summary/project/:projectId
 *   GET    /ai/design-cost/summary/order/:orderId
 *   GET    /ai/design-cost/summary/tenant
 *   GET    /ai/design-cost/breakdown/project/:projectId
 *   POST   /ai/design-cost/estimate                 — pre-execution cost estimate
 *   GET    /ai/design-cost/reconcile                — reconciliation scan
 *   GET    /ai/design-cost/budget/check             — budget snapshot for a scope
 *   GET    /ai/design-cost/budget/policies          — list budget policies
 *   POST   /ai/design-cost/budget/policies          — create a budget policy
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod/v4";
import {
  recordDesignCostAttribution,
  estimateDesignCost,
  calculateDesignCost,
  getProjectCostSummary,
  getOrderCostSummary,
  getTenantCostSummary,
  getProjectCostBreakdown,
  checkDesignBudget,
  getBudgetPolicies,
  createBudgetPolicy,
  reconcileDesignCosts,
} from "../services/designCostAttributionService.js";
import { resolveAuthenticatedTenantContext } from "../security/tenantResolution.js";
import { db, designCostAttributionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router = Router();

// ── Validation schemas ────────────────────────────────────────────────────────

const UsageSchema = z.object({
  inputTokens:          z.number().int().nonnegative().nullable().optional(),
  outputTokens:         z.number().int().nonnegative().nullable().optional(),
  cachedTokens:         z.number().int().nonnegative().nullable().optional(),
  imageGenerationCount: z.number().int().nonnegative().nullable().optional(),
  renderCount:          z.number().int().nonnegative().nullable().optional(),
  runtimeSeconds:       z.number().nonnegative().nullable().optional(),
  storageBytes:         z.number().int().nonnegative().nullable().optional(),
  requestCount:         z.number().int().nonnegative().optional(),
  retryCount:           z.number().int().nonnegative().optional(),
  usageAvailable:       z.boolean(),
});

const CostSchema = z.object({
  estimatedCostUsd:         z.number().nonnegative().nullable().optional(),
  providerReportedCostUsd:  z.number().nonnegative().nullable().optional(),
  calculatedCostUsd:        z.number().nonnegative().nullable().optional(),
  adjustedCostUsd:          z.number().nonnegative().nullable().optional(),
  finalAttributableCostUsd: z.number().nonnegative().nullable().optional(),
  currency:                 z.string().min(3).max(3).default("USD"),
  pricingVersion:           z.string().nullable().optional(),
  pricingSource:            z.enum(["ai_provider_pricing", "manual", "default_fallback"]).default("ai_provider_pricing"),
  pricingCalculatedAt:      z.string().datetime().nullable().optional(),
});

const AttributionSchema = z.object({
  projectId:    z.string().nullable().optional(),
  orderId:      z.string().nullable().optional(),
  workflowId:   z.string().nullable().optional(),
  stageId:      z.string().nullable().optional(),
  artifactId:   z.string().nullable().optional(),
  capabilityId: z.string().nullable().optional(),
  pluginId:     z.string().nullable().optional(),
  agentId:      z.string().nullable().optional(),
  jobId:        z.string().nullable().optional(),
  attempt:      z.number().int().nonnegative().default(0),
  providerId:   z.string().nullable().optional(),
  modelId:      z.string().nullable().optional(),
  operationType: z.string().min(1),
  correlationId: z.string().nullable().optional(),
  idempotencyKey: z.string().min(1),
});

const RecordAttributionBody = z.object({
  attribution:     AttributionSchema,
  usage:           UsageSchema,
  cost:            CostSchema,
  operationStatus: z.enum(["pending", "running", "success", "failed", "cancelled", "partial"]).default("success"),
  costRecordId:    z.number().int().positive().nullable().optional(),
});

const EstimateBody = z.object({
  providerId:   z.string().min(1),
  modelId:      z.string().min(1),
  inputTokens:  z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedTokens: z.number().int().nonnegative().optional(),
  imageCount:   z.number().int().nonnegative().optional(),
});

const BudgetPolicyBody = z.object({
  scopeType:           z.enum(["tenant", "project", "order", "workflow", "stage", "capability"]),
  scopeId:             z.string().min(1),
  limitType:           z.enum(["per_run", "daily", "monthly"]),
  actionType:          z.enum(["soft_warn", "hard_block", "require_approval"]),
  limitAmountUsd:      z.number().positive(),
  warningThresholdPct: z.number().int().min(1).max(100).default(80),
  currency:            z.string().min(3).max(3).default("USD"),
  active:              z.boolean().default(true),
  description:         z.string().max(500).nullable().optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function badRequest(res: Response, message: string): void {
  res.status(400).json({ error: message });
}

function serverError(res: Response, err: unknown, label: string): void {
  logger.error({ err }, `[design-cost-attribution] ${label}`);
  res.status(500).json({ error: "Internal server error" });
}

// ── POST /ai/design-cost/attribution ─────────────────────────────────────────

router.post("/ai/design-cost/attribution", async (req: Request, res: Response) => {
  const ctx = resolveAuthenticatedTenantContext(req);

  const parsed = RecordAttributionBody.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, parsed.error.message);
    return;
  }

  const { attribution, usage, cost, operationStatus, costRecordId } = parsed.data;

  try {
    const result = await recordDesignCostAttribution({
      attribution: {
        ...attribution,
        tenantId: ctx.tenantId,
        attempt: attribution.attempt,
        operationType: attribution.operationType,
        idempotencyKey: attribution.idempotencyKey,
      },
      usage: {
        ...usage,
        usageAvailable: usage.usageAvailable,
      },
      cost: {
        ...cost,
        currency: cost.currency,
        pricingSource: cost.pricingSource,
        pricingCalculatedAt: cost.pricingCalculatedAt ? new Date(cost.pricingCalculatedAt) : null,
      },
      operationStatus,
      costRecordId: costRecordId ?? null,
    });

    res.status(201).json(result);
  } catch (err) {
    serverError(res, err, "record attribution");
  }
});

// ── GET /ai/design-cost/attribution/:jobId ────────────────────────────────────

router.get("/ai/design-cost/attribution/:jobId", async (req: Request, res: Response) => {
  const ctx    = resolveAuthenticatedTenantContext(req);
  const { jobId } = req.params as { jobId: string };

  try {
    const rows = await db
      .select()
      .from(designCostAttributionsTable)
      .where(
        and(
          eq(designCostAttributionsTable.tenantId, ctx.tenantId),
          eq(designCostAttributionsTable.jobId,    jobId),
        ),
      );

    if (rows.length === 0) {
      res.status(404).json({ error: "Attribution not found" });
      return;
    }

    res.json(rows);
  } catch (err) {
    serverError(res, err, "get attribution by jobId");
  }
});

// ── GET /ai/design-cost/summary/project/:projectId ───────────────────────────

router.get("/ai/design-cost/summary/project/:projectId", async (req: Request, res: Response) => {
  const ctx       = resolveAuthenticatedTenantContext(req);
  const { projectId } = req.params as { projectId: string };

  try {
    const summary = await getProjectCostSummary(projectId, ctx.tenantId);
    res.json(summary);
  } catch (err) {
    serverError(res, err, "project summary");
  }
});

// ── GET /ai/design-cost/summary/order/:orderId ────────────────────────────────

router.get("/ai/design-cost/summary/order/:orderId", async (req: Request, res: Response) => {
  const ctx     = resolveAuthenticatedTenantContext(req);
  const { orderId } = req.params as { orderId: string };

  try {
    const summary = await getOrderCostSummary(orderId, ctx.tenantId);
    res.json(summary);
  } catch (err) {
    serverError(res, err, "order summary");
  }
});

// ── GET /ai/design-cost/summary/tenant ───────────────────────────────────────

router.get("/ai/design-cost/summary/tenant", async (req: Request, res: Response) => {
  const ctx = resolveAuthenticatedTenantContext(req);

  try {
    const summary = await getTenantCostSummary(ctx.tenantId);
    res.json(summary);
  } catch (err) {
    serverError(res, err, "tenant summary");
  }
});

// ── GET /ai/design-cost/breakdown/project/:projectId ─────────────────────────

router.get("/ai/design-cost/breakdown/project/:projectId", async (req: Request, res: Response) => {
  const ctx       = resolveAuthenticatedTenantContext(req);
  const { projectId } = req.params as { projectId: string };

  try {
    const breakdown = await getProjectCostBreakdown(projectId, ctx.tenantId);
    res.json(breakdown);
  } catch (err) {
    serverError(res, err, "project breakdown");
  }
});

// ── POST /ai/design-cost/estimate ─────────────────────────────────────────────

router.post("/ai/design-cost/estimate", async (req: Request, res: Response) => {
  const parsed = EstimateBody.safeParse(req.body);
  if (!parsed.success) {
    badRequest(res, parsed.error.message);
    return;
  }

  try {
    const estimate = await estimateDesignCost(parsed.data);
    res.json(estimate);
  } catch (err) {
    serverError(res, err, "estimate");
  }
});

// ── GET /ai/design-cost/reconcile ─────────────────────────────────────────────

router.get("/ai/design-cost/reconcile", async (req: Request, res: Response) => {
  const ctx               = resolveAuthenticatedTenantContext(req);
  const { start, end, variance } = req.query as Record<string, string | undefined>;

  const varianceThresholdPct = variance ? parseInt(variance, 10) : 20;

  try {
    const result = await reconcileDesignCosts({
      tenantId:             ctx.tenantId,
      windowStartDate:      start ? new Date(start) : undefined,
      windowEndDate:        end   ? new Date(end)   : undefined,
      varianceThresholdPct: isNaN(varianceThresholdPct) ? 20 : varianceThresholdPct,
    });

    res.json(result);
  } catch (err) {
    serverError(res, err, "reconcile");
  }
});

// ── GET /ai/design-cost/budget/check ──────────────────────────────────────────

router.get("/ai/design-cost/budget/check", async (req: Request, res: Response) => {
  const ctx                  = resolveAuthenticatedTenantContext(req);
  const { scopeType, scopeId } = req.query as Record<string, string | undefined>;

  if (!scopeType || !scopeId) {
    badRequest(res, "scopeType and scopeId query params are required");
    return;
  }

  const validScopeTypes = ["tenant", "project", "order", "workflow", "stage", "capability"] as const;
  if (!validScopeTypes.includes(scopeType as (typeof validScopeTypes)[number])) {
    badRequest(res, `scopeType must be one of: ${validScopeTypes.join(", ")}`);
    return;
  }

  try {
    const snapshots = await checkDesignBudget(
      ctx.tenantId,
      scopeType as (typeof validScopeTypes)[number],
      scopeId,
    );
    res.json(snapshots);
  } catch (err) {
    serverError(res, err, "budget check");
  }
});

// ── GET /ai/design-cost/budget/policies ───────────────────────────────────────

router.get("/ai/design-cost/budget/policies", async (req: Request, res: Response) => {
  const ctx                            = resolveAuthenticatedTenantContext(req);
  const { scopeType, scopeId, active } = req.query as Record<string, string | undefined>;
  const activeOnly                     = active !== "false";

  try {
    const policies = await getBudgetPolicies(
      ctx.tenantId,
      scopeType as Parameters<typeof getBudgetPolicies>[1],
      scopeId,
      activeOnly,
    );
    res.json(policies);
  } catch (err) {
    serverError(res, err, "list policies");
  }
});

// ── POST /ai/design-cost/budget/policies ──────────────────────────────────────

router.post("/ai/design-cost/budget/policies", async (req: Request, res: Response) => {
  const ctx    = resolveAuthenticatedTenantContext(req);
  const parsed = BudgetPolicyBody.safeParse(req.body);

  if (!parsed.success) {
    badRequest(res, parsed.error.message);
    return;
  }

  try {
    const policy = await createBudgetPolicy({
      tenantId: ctx.tenantId,
      ...parsed.data,
    });
    res.status(201).json(policy);
  } catch (err) {
    serverError(res, err, "create policy");
  }
});

export default router;
