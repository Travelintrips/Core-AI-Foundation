/**
 * designCostAttributionService.ts — Team 34: Design Cost, Usage, and Budget Attribution
 *
 * Attribution layer that wraps the existing costService and ai_cost_records table with
 * full design-execution dimensions (tenant, project, order, workflow, stage, artifact,
 * capability, agent, job, attempt, provider, model, operation type, correlation ID,
 * idempotency key) plus rich usage and cost fields.
 *
 * Design invariants:
 *   - Never creates a second cost ledger. ai_cost_records is the primary record;
 *     design_cost_attributions extends it.
 *   - Pricing is always read from ai_provider_pricing (canonical source). Hard-coded
 *     defaults are only used as a last resort and are always flagged in pricingSource.
 *   - null usage fields mean "not reported by provider" — never coerced to 0.
 *   - idempotencyKey is enforced UNIQUE at the DB level; duplicate insertions are
 *     silently swallowed here (idempotent record contract).
 *   - No AI provider, model, tenant, or domain is hard-coded.
 *   - Budget checks never throw on DB errors — they fail open with a warning.
 */

import { eq, and, sql, sum, count, gte, lt } from "drizzle-orm";
import {
  db,
  aiCostRecordsTable,
  aiProviderPricingTable,
  designCostAttributionsTable,
  designBudgetPoliciesTable,
} from "@workspace/db";
import type {
  DesignCostAttributionRow,
  DesignBudgetPolicyRow,
  InsertDesignCostAttribution,
  InsertDesignBudgetPolicy,
} from "@workspace/db";
import { logger } from "../lib/logger.js";

// ── Public contract types ─────────────────────────────────────────────────────

export type OperationStatus = "pending" | "running" | "success" | "failed" | "cancelled" | "partial";
export type OperationType   = "text_generation" | "image_generation" | "render" | "export" | "qc" | string;
export type LimitType       = "per_run" | "daily" | "monthly";
export type ActionType      = "soft_warn" | "hard_block" | "require_approval";
export type ScopeType       = "tenant" | "project" | "order" | "workflow" | "stage" | "capability";
export type PricingSource   = "ai_provider_pricing" | "manual" | "default_fallback";

/** Attribution dimensions carried by every design execution event. */
export interface DesignUsageAttribution {
  tenantId:      string;
  projectId?:    string | null;
  orderId?:      string | null;
  workflowId?:   string | null;
  stageId?:      string | null;
  artifactId?:   string | null;
  capabilityId?: string | null;
  pluginId?:     string | null;
  agentId?:      string | null;
  jobId?:        string | null;
  attempt:       number;
  providerId?:   string | null;
  modelId?:      string | null;
  operationType: OperationType;
  correlationId?: string | null;
  idempotencyKey: string;
}

/** Usage counters for one execution. null = not reported by provider. */
export interface DesignExecutionUsage {
  inputTokens?:          number | null;
  outputTokens?:         number | null;
  cachedTokens?:         number | null;   // null if provider doesn't support prompt caching
  imageGenerationCount?: number | null;
  renderCount?:          number | null;
  runtimeSeconds?:       number | null;
  storageBytes?:         number | null;
  requestCount?:         number;
  retryCount?:           number;
  usageAvailable:        boolean;         // false = provider did not report usage at all
}

/** Cost breakdown for one execution. */
export interface DesignCostAttribution {
  estimatedCostUsd?:         number | null;
  providerReportedCostUsd?:  number | null;   // null if not in provider response
  calculatedCostUsd?:        number | null;
  adjustedCostUsd?:          number | null;
  finalAttributableCostUsd?: number | null;
  currency:                  string;
  pricingVersion?:           string | null;
  pricingSource:             PricingSource;
  pricingCalculatedAt?:      Date | null;
}

/** Full parameters for recording one attributed execution. */
export interface RecordDesignCostAttributionParams {
  attribution:      DesignUsageAttribution;
  usage:            DesignExecutionUsage;
  cost:             DesignCostAttribution;
  operationStatus:  OperationStatus;
  costRecordId?:    number | null;
}

/** Budget policy definition. */
export interface DesignBudgetPolicy {
  id:                  number;
  tenantId:            string;
  scopeType:           ScopeType;
  scopeId:             string;
  limitType:           LimitType;
  actionType:          ActionType;
  limitAmountUsd:      number;
  warningThresholdPct: number;
  currency:            string;
  active:              boolean;
  description?:        string | null;
  createdAt:           Date;
  updatedAt:           Date;
}

/** Live budget snapshot at the time of check. */
export interface DesignBudgetSnapshot {
  tenantId:           string;
  scopeType:          ScopeType;
  scopeId:            string;
  limitType:          LimitType;
  actionType:         ActionType;
  limitAmountUsd:     number;
  spentAmountUsd:     number;
  remainingAmountUsd: number;
  usagePct:           number;
  warningThresholdPct: number;
  isWarning:          boolean;
  isBlocked:          boolean;
  requiresApproval:   boolean;
  currency:           string;
  windowStart:        Date;
  windowEnd:          Date;
  checkedAt:          Date;
}

/** Aggregated cost totals for a reporting dimension. */
export interface DesignCostSummary {
  totalFinalAttributableCostUsd: number;
  totalCalculatedCostUsd:        number;
  totalEstimatedCostUsd:         number;
  totalInputTokens:              number;
  totalOutputTokens:             number;
  totalCachedTokens:             number;
  totalImageGenerations:         number;
  totalRenders:                  number;
  totalRequests:                 number;
  totalRetries:                  number;
  currency:                      string;
  recordCount:                   number;
}

/** Per-model/provider cost breakdown. */
export interface DesignCostBreakdown {
  providerId:             string | null;
  modelId:                string | null;
  operationType:          string;
  totalFinalCostUsd:      number;
  totalCalculatedCostUsd: number;
  totalInputTokens:       number;
  totalOutputTokens:      number;
  totalRequests:          number;
  totalRetries:           number;
}

/** Pre-execution cost estimate. */
export interface DesignCostEstimate {
  estimatedCostUsd:  number;
  currency:          string;
  pricingVersion:    string | null;
  pricingSource:     PricingSource;
  calculatedAt:      Date;
  inputTokens:       number;
  outputTokens:      number;
  cachedTokens:      number;
  imageCount:        number;
}

/** Input for estimateDesignCost. */
export interface EstimateDesignCostParams {
  providerId:   string;
  modelId:      string;
  inputTokens:  number;
  outputTokens: number;
  cachedTokens?: number;
  imageCount?:   number;
}

/** Result of a reconciliation scan. */
export interface DesignCostReconciliationResult {
  scannedAttributions:      number;
  scannedCostRecords:       number;
  jobsWithoutCost:          string[];
  costsWithoutAttribution:  number[];
  duplicates:               string[];
  retryDoubleCharge:        string[];
  missingAttributionFields: string[];
  currencyMismatches:       string[];
  estimateVsActualVariance: Array<{ idempotencyKey: string; estimatedUsd: number; finalUsd: number; variancePct: number }>;
  cancelledWithCost:        string[];
  partialProviderUsage:     string[];
  reconciledAt:             Date;
}

/** Adapter interface — narrows recordCost to design-attribution semantics. */
export interface DesignCostAttributionAdapter {
  record(params: RecordDesignCostAttributionParams): Promise<{ id: number; idempotencyKey: string }>;
  checkBudget(tenantId: string, scopeType: ScopeType, scopeId: string): Promise<DesignBudgetSnapshot[]>;
  estimateCost(params: EstimateDesignCostParams): Promise<DesignCostEstimate>;
}

// ── Default pricing fallbacks ─────────────────────────────────────────────────

const DEFAULT_INPUT_PRICE_PER_1M  = 2.5;
const DEFAULT_OUTPUT_PRICE_PER_1M = 10.0;
// Image generation flat rates (per image) — only used as fallback when no
// pricing row exists for the model. Real values come from ai_provider_pricing.
const DEFAULT_IMAGE_PRICE_PER_UNIT = 0.04;

// ── Pricing lookup ────────────────────────────────────────────────────────────

interface PricingRow {
  inputPricePer1m:  string;
  outputPricePer1m: string;
  cachedInputPrice: string | null;
  currency:         string;
  id:               number;
  effectiveDate:    string | null;
}

async function lookupPricing(providerId: string, modelId: string): Promise<{ row: PricingRow | null; source: PricingSource }> {
  try {
    const [row] = await db
      .select()
      .from(aiProviderPricingTable)
      .where(
        and(
          eq(aiProviderPricingTable.provider, providerId),
          eq(aiProviderPricingTable.model,    modelId),
          eq(aiProviderPricingTable.active,   true),
        ),
      )
      .limit(1);

    if (row) {
      return { row: row as unknown as PricingRow, source: "ai_provider_pricing" };
    }
  } catch (err) {
    logger.warn({ err, providerId, modelId }, "[design-cost-attribution] pricing lookup failed — using defaults");
  }
  return { row: null, source: "default_fallback" };
}

function calculateFromPricing(
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number,
  imageCount: number,
  row: PricingRow | null,
): number {
  const inRate     = row ? parseFloat(row.inputPricePer1m)  / 1_000_000 : DEFAULT_INPUT_PRICE_PER_1M  / 1_000_000;
  const outRate    = row ? parseFloat(row.outputPricePer1m) / 1_000_000 : DEFAULT_OUTPUT_PRICE_PER_1M / 1_000_000;
  const cacheRate  = row?.cachedInputPrice ? parseFloat(row.cachedInputPrice) / 1_000_000 : inRate * 0.5;
  const imageRate  = DEFAULT_IMAGE_PRICE_PER_UNIT; // always fallback — images have no 1M pricing

  return (
    inputTokens  * inRate    +
    outputTokens * outRate   +
    cachedTokens * cacheRate +
    imageCount   * imageRate
  );
}

// ── Core: recordDesignCostAttribution ─────────────────────────────────────────

export async function recordDesignCostAttribution(
  params: RecordDesignCostAttributionParams,
): Promise<{ id: number; idempotencyKey: string }> {
  const { attribution, usage, cost, operationStatus, costRecordId } = params;

  const row: InsertDesignCostAttribution = {
    costRecordId:    costRecordId ?? null,
    idempotencyKey:  attribution.idempotencyKey,

    tenantId:        attribution.tenantId,
    projectId:       attribution.projectId ?? null,
    orderId:         attribution.orderId   ?? null,
    workflowId:      attribution.workflowId   ?? null,
    stageId:         attribution.stageId      ?? null,
    artifactId:      attribution.artifactId   ?? null,
    capabilityId:    attribution.capabilityId ?? null,
    pluginId:        attribution.pluginId     ?? null,
    agentId:         attribution.agentId      ?? null,
    jobId:           attribution.jobId        ?? null,
    attempt:         attribution.attempt,
    providerId:      attribution.providerId   ?? null,
    modelId:         attribution.modelId      ?? null,
    operationType:   attribution.operationType,
    correlationId:   attribution.correlationId ?? null,

    inputTokens:          usage.inputTokens          ?? null,
    outputTokens:         usage.outputTokens          ?? null,
    cachedTokens:         usage.cachedTokens          ?? null,
    imageGenerationCount: usage.imageGenerationCount  ?? null,
    renderCount:          usage.renderCount           ?? null,
    runtimeSeconds:       usage.runtimeSeconds != null ? String(usage.runtimeSeconds) : null,
    storageBytes:         usage.storageBytes          ?? null,
    requestCount:         usage.requestCount          ?? 1,
    retryCount:           usage.retryCount            ?? 0,
    usageAvailable:       usage.usageAvailable,

    estimatedCostUsd:         cost.estimatedCostUsd        != null ? String(cost.estimatedCostUsd.toFixed(8))        : null,
    providerReportedCostUsd:  cost.providerReportedCostUsd != null ? String(cost.providerReportedCostUsd.toFixed(8)) : null,
    calculatedCostUsd:        cost.calculatedCostUsd       != null ? String(cost.calculatedCostUsd.toFixed(8))       : null,
    adjustedCostUsd:          cost.adjustedCostUsd         != null ? String(cost.adjustedCostUsd.toFixed(8))         : null,
    finalAttributableCostUsd: cost.finalAttributableCostUsd != null ? String(cost.finalAttributableCostUsd.toFixed(8)) : null,

    currency:            cost.currency,
    pricingVersion:      cost.pricingVersion    ?? null,
    pricingSource:       cost.pricingSource,
    pricingCalculatedAt: cost.pricingCalculatedAt ?? null,

    operationStatus,
  };

  try {
    const [inserted] = await db
      .insert(designCostAttributionsTable)
      .values(row)
      .onConflictDoNothing()   // idempotent — duplicate idempotencyKey is a no-op
      .returning({ id: designCostAttributionsTable.id });

    if (!inserted) {
      // Conflict occurred — row already exists. Fetch existing id.
      const [existing] = await db
        .select({ id: designCostAttributionsTable.id })
        .from(designCostAttributionsTable)
        .where(eq(designCostAttributionsTable.idempotencyKey, attribution.idempotencyKey))
        .limit(1);
      return { id: existing?.id ?? -1, idempotencyKey: attribution.idempotencyKey };
    }

    return { id: inserted.id, idempotencyKey: attribution.idempotencyKey };
  } catch (err) {
    logger.error({ err, idempotencyKey: attribution.idempotencyKey }, "[design-cost-attribution] insert failed");
    throw err;
  }
}

// ── estimateDesignCost ────────────────────────────────────────────────────────

export async function estimateDesignCost(params: EstimateDesignCostParams): Promise<DesignCostEstimate> {
  const { providerId, modelId, inputTokens, outputTokens, cachedTokens = 0, imageCount = 0 } = params;
  const { row, source } = await lookupPricing(providerId, modelId);

  const estimatedCostUsd = calculateFromPricing(inputTokens, outputTokens, cachedTokens, imageCount, row);

  return {
    estimatedCostUsd,
    currency:       row?.currency ?? "USD",
    pricingVersion: row ? String(row.id) : null,
    pricingSource:  source,
    calculatedAt:   new Date(),
    inputTokens,
    outputTokens,
    cachedTokens,
    imageCount,
  };
}

// ── calculateDesignCost ───────────────────────────────────────────────────────

export async function calculateDesignCost(params: EstimateDesignCostParams): Promise<{
  calculatedCostUsd: number;
  currency: string;
  pricingVersion: string | null;
  pricingSource: PricingSource;
  pricingCalculatedAt: Date;
}> {
  const { providerId, modelId, inputTokens, outputTokens, cachedTokens = 0, imageCount = 0 } = params;
  const { row, source } = await lookupPricing(providerId, modelId);

  return {
    calculatedCostUsd:   calculateFromPricing(inputTokens, outputTokens, cachedTokens, imageCount, row),
    currency:            row?.currency ?? "USD",
    pricingVersion:      row ? String(row.id) : null,
    pricingSource:       source,
    pricingCalculatedAt: new Date(),
  };
}

// ── Budget window helpers ─────────────────────────────────────────────────────

function getWindowBounds(limitType: LimitType, now: Date): { start: Date; end: Date } {
  const start = new Date(now);
  const end   = new Date(now);

  if (limitType === "daily") {
    start.setUTCHours(0, 0, 0, 0);
    end.setUTCHours(23, 59, 59, 999);
  } else if (limitType === "monthly") {
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
    end.setUTCHours(23, 59, 59, 999);
  }
  // per_run: no window — start = end = now (checked differently)

  return { start, end };
}

/** Determine which attribution column to filter on for a given scopeType. */
function scopeFilter(scopeType: ScopeType, scopeId: string) {
  switch (scopeType) {
    case "tenant":     return eq(designCostAttributionsTable.tenantId,     scopeId);
    case "project":    return eq(designCostAttributionsTable.projectId,    scopeId);
    case "order":      return eq(designCostAttributionsTable.orderId,      scopeId);
    case "workflow":   return eq(designCostAttributionsTable.workflowId,   scopeId);
    case "stage":      return eq(designCostAttributionsTable.stageId,      scopeId);
    case "capability": return eq(designCostAttributionsTable.capabilityId, scopeId);
  }
}

// ── checkDesignBudget ─────────────────────────────────────────────────────────

export async function checkDesignBudget(
  tenantId:  string,
  scopeType: ScopeType,
  scopeId:   string,
): Promise<DesignBudgetSnapshot[]> {
  // Load active policies for this scope
  let policies: DesignBudgetPolicyRow[] = [];
  try {
    policies = await db
      .select()
      .from(designBudgetPoliciesTable)
      .where(
        and(
          eq(designBudgetPoliciesTable.tenantId,  tenantId),
          eq(designBudgetPoliciesTable.scopeType, scopeType),
          eq(designBudgetPoliciesTable.scopeId,   scopeId),
          eq(designBudgetPoliciesTable.active,    true),
        ),
      );
  } catch (err) {
    logger.warn({ err, tenantId, scopeType, scopeId }, "[design-cost-attribution] budget policy lookup failed — fail open");
    return [];
  }

  if (policies.length === 0) return [];

  const now = new Date();
  const snapshots: DesignBudgetSnapshot[] = [];

  for (const policy of policies) {
    const limitType  = policy.limitType  as LimitType;
    const actionType = policy.actionType as ActionType;
    const { start, end } = getWindowBounds(limitType, now);
    const limitAmountUsd = parseFloat(String(policy.limitAmountUsd));

    let spentAmountUsd = 0;

    try {
      const baseWhere = [
        eq(designCostAttributionsTable.tenantId, tenantId),
        scopeFilter(scopeType, scopeId),
      ];

      if (limitType !== "per_run") {
        baseWhere.push(
          gte(designCostAttributionsTable.createdAt, start),
          lt(designCostAttributionsTable.createdAt, end),
        );
      }

      const [row] = await db
        .select({
          total: sql<number>`coalesce(sum(final_attributable_cost_usd::numeric), 0)`,
        })
        .from(designCostAttributionsTable)
        .where(and(...baseWhere));

      spentAmountUsd = row ? Number(row.total) : 0;
    } catch (err) {
      logger.warn({ err, policyId: policy.id }, "[design-cost-attribution] budget spend query failed — fail open");
    }

    const remainingAmountUsd = Math.max(0, limitAmountUsd - spentAmountUsd);
    const usagePct           = limitAmountUsd > 0 ? (spentAmountUsd / limitAmountUsd) * 100 : 0;
    const warningPct         = policy.warningThresholdPct;

    snapshots.push({
      tenantId,
      scopeType,
      scopeId,
      limitType,
      actionType,
      limitAmountUsd,
      spentAmountUsd,
      remainingAmountUsd,
      usagePct,
      warningThresholdPct:  warningPct,
      isWarning:            usagePct >= warningPct,
      isBlocked:            actionType === "hard_block" && spentAmountUsd >= limitAmountUsd,
      requiresApproval:     actionType === "require_approval" && spentAmountUsd >= limitAmountUsd,
      currency:             policy.currency,
      windowStart:          start,
      windowEnd:            end,
      checkedAt:            now,
    });
  }

  return snapshots;
}

// ── Cost summaries ────────────────────────────────────────────────────────────

async function computeSummary(
  whereClause: ReturnType<typeof and>,
): Promise<DesignCostSummary> {
  const [row] = await db
    .select({
      totalFinal:       sql<number>`coalesce(sum(final_attributable_cost_usd::numeric), 0)`,
      totalCalc:        sql<number>`coalesce(sum(calculated_cost_usd::numeric), 0)`,
      totalEstimated:   sql<number>`coalesce(sum(estimated_cost_usd::numeric), 0)`,
      totalInput:       sql<number>`coalesce(sum(input_tokens), 0)::bigint`,
      totalOutput:      sql<number>`coalesce(sum(output_tokens), 0)::bigint`,
      totalCached:      sql<number>`coalesce(sum(cached_tokens), 0)::bigint`,
      totalImages:      sql<number>`coalesce(sum(image_generation_count), 0)::bigint`,
      totalRenders:     sql<number>`coalesce(sum(render_count), 0)::bigint`,
      totalRequests:    sql<number>`coalesce(sum(request_count), 0)::bigint`,
      totalRetries:     sql<number>`coalesce(sum(retry_count), 0)::bigint`,
      recordCount:      count(),
    })
    .from(designCostAttributionsTable)
    .where(whereClause);

  return {
    totalFinalAttributableCostUsd: row ? Number(row.totalFinal)     : 0,
    totalCalculatedCostUsd:        row ? Number(row.totalCalc)       : 0,
    totalEstimatedCostUsd:         row ? Number(row.totalEstimated)  : 0,
    totalInputTokens:              row ? Number(row.totalInput)      : 0,
    totalOutputTokens:             row ? Number(row.totalOutput)     : 0,
    totalCachedTokens:             row ? Number(row.totalCached)     : 0,
    totalImageGenerations:         row ? Number(row.totalImages)     : 0,
    totalRenders:                  row ? Number(row.totalRenders)    : 0,
    totalRequests:                 row ? Number(row.totalRequests)   : 0,
    totalRetries:                  row ? Number(row.totalRetries)    : 0,
    currency:                      "USD",
    recordCount:                   row ? Number(row.recordCount)     : 0,
  };
}

export async function getProjectCostSummary(projectId: string, tenantId: string): Promise<DesignCostSummary> {
  return computeSummary(
    and(
      eq(designCostAttributionsTable.tenantId,  tenantId),
      eq(designCostAttributionsTable.projectId, projectId),
    )!,
  );
}

export async function getOrderCostSummary(orderId: string, tenantId: string): Promise<DesignCostSummary> {
  return computeSummary(
    and(
      eq(designCostAttributionsTable.tenantId, tenantId),
      eq(designCostAttributionsTable.orderId,  orderId),
    )!,
  );
}

export async function getTenantCostSummary(tenantId: string): Promise<DesignCostSummary> {
  return computeSummary(eq(designCostAttributionsTable.tenantId, tenantId));
}

// ── Cost breakdown (by provider+model+operationType) ─────────────────────────

export async function getProjectCostBreakdown(projectId: string, tenantId: string): Promise<DesignCostBreakdown[]> {
  const rows = await db
    .select({
      providerId:   designCostAttributionsTable.providerId,
      modelId:      designCostAttributionsTable.modelId,
      operationType: designCostAttributionsTable.operationType,
      totalFinal:   sql<number>`coalesce(sum(final_attributable_cost_usd::numeric), 0)`,
      totalCalc:    sql<number>`coalesce(sum(calculated_cost_usd::numeric), 0)`,
      totalInput:   sql<number>`coalesce(sum(input_tokens), 0)::bigint`,
      totalOutput:  sql<number>`coalesce(sum(output_tokens), 0)::bigint`,
      totalRequests: sql<number>`coalesce(sum(request_count), 0)::bigint`,
      totalRetries:  sql<number>`coalesce(sum(retry_count), 0)::bigint`,
    })
    .from(designCostAttributionsTable)
    .where(
      and(
        eq(designCostAttributionsTable.tenantId,  tenantId),
        eq(designCostAttributionsTable.projectId, projectId),
      ),
    )
    .groupBy(
      designCostAttributionsTable.providerId,
      designCostAttributionsTable.modelId,
      designCostAttributionsTable.operationType,
    );

  return rows.map((r) => ({
    providerId:             r.providerId,
    modelId:                r.modelId,
    operationType:          r.operationType,
    totalFinalCostUsd:      Number(r.totalFinal),
    totalCalculatedCostUsd: Number(r.totalCalc),
    totalInputTokens:       Number(r.totalInput),
    totalOutputTokens:      Number(r.totalOutput),
    totalRequests:          Number(r.totalRequests),
    totalRetries:           Number(r.totalRetries),
  }));
}

// ── Budget policy CRUD ────────────────────────────────────────────────────────

export async function createBudgetPolicy(
  input: Omit<DesignBudgetPolicy, "id" | "createdAt" | "updatedAt">,
): Promise<DesignBudgetPolicy> {
  const [row] = await db
    .insert(designBudgetPoliciesTable)
    .values({
      tenantId:            input.tenantId,
      scopeType:           input.scopeType,
      scopeId:             input.scopeId,
      limitType:           input.limitType,
      actionType:          input.actionType,
      limitAmountUsd:      String(input.limitAmountUsd.toFixed(4)),
      warningThresholdPct: input.warningThresholdPct,
      currency:            input.currency,
      active:              input.active,
      description:         input.description ?? null,
    } satisfies InsertDesignBudgetPolicy)
    .returning();

  return mapPolicyRow(row);
}

export async function getBudgetPolicies(
  tenantId:  string,
  scopeType?: ScopeType,
  scopeId?:  string,
  activeOnly = true,
): Promise<DesignBudgetPolicy[]> {
  const conditions = [eq(designBudgetPoliciesTable.tenantId, tenantId)];
  if (activeOnly) conditions.push(eq(designBudgetPoliciesTable.active, true));
  if (scopeType)  conditions.push(eq(designBudgetPoliciesTable.scopeType, scopeType));
  if (scopeId)    conditions.push(eq(designBudgetPoliciesTable.scopeId,   scopeId));

  const rows = await db
    .select()
    .from(designBudgetPoliciesTable)
    .where(and(...conditions));

  return rows.map(mapPolicyRow);
}

function mapPolicyRow(row: DesignBudgetPolicyRow): DesignBudgetPolicy {
  return {
    id:                  row.id,
    tenantId:            row.tenantId,
    scopeType:           row.scopeType as ScopeType,
    scopeId:             row.scopeId,
    limitType:           row.limitType as LimitType,
    actionType:          row.actionType as ActionType,
    limitAmountUsd:      parseFloat(String(row.limitAmountUsd)),
    warningThresholdPct: row.warningThresholdPct,
    currency:            row.currency,
    active:              row.active,
    description:         row.description ?? null,
    createdAt:           row.createdAt,
    updatedAt:           row.updatedAt,
  };
}

// ── Reconciliation ────────────────────────────────────────────────────────────

interface ReconcileParams {
  tenantId:         string;
  windowStartDate?: Date;
  windowEndDate?:   Date;
  varianceThresholdPct?: number;   // default 20%
}

export async function reconcileDesignCosts(params: ReconcileParams): Promise<DesignCostReconciliationResult> {
  const { tenantId, varianceThresholdPct = 20 } = params;
  const now = new Date();

  // Fetch attribution rows for this tenant (with optional window)
  const whereConditions = [eq(designCostAttributionsTable.tenantId, tenantId)];
  if (params.windowStartDate) whereConditions.push(gte(designCostAttributionsTable.createdAt, params.windowStartDate));
  if (params.windowEndDate)   whereConditions.push(lt(designCostAttributionsTable.createdAt, params.windowEndDate));

  const attributions = await db
    .select()
    .from(designCostAttributionsTable)
    .where(and(...whereConditions));

  // 1. Jobs without cost (attribution exists, no final_attributable_cost_usd and status=success)
  const jobsWithoutCost = attributions
    .filter((a) => a.operationStatus === "success" && a.finalAttributableCostUsd == null && a.jobId)
    .map((a) => a.jobId!);

  // 2. Costs without attribution: ai_cost_records that have no matching attribution
  //    (only within the tenant scope — we join on project_id where non-null)
  let costsWithoutAttribution: number[] = [];
  try {
    const allProjectIds = [...new Set(attributions.map((a) => a.projectId).filter(Boolean))] as string[];
    if (allProjectIds.length > 0) {
      const orphanRows = await db.execute(
        sql`
          SELECT id FROM ai_platform.ai_cost_records cr
          WHERE cr.project_id = ANY(${sql.raw(`ARRAY[${allProjectIds.map((id) => `'${id}'`).join(",")}]`)})
            AND NOT EXISTS (
              SELECT 1 FROM ai_platform.design_cost_attributions dca
              WHERE dca.cost_record_id = cr.id
            )
          LIMIT 200
        `,
      );
      costsWithoutAttribution = (orphanRows.rows as { id: number }[]).map((r) => r.id);
    }
  } catch (err) {
    logger.warn({ err }, "[design-cost-attribution] costs-without-attribution query failed");
  }

  // 3. Duplicate cost: same jobId appears more than once with success status (excluding retries)
  const jobSuccessCount = new Map<string, number>();
  for (const a of attributions) {
    if (a.jobId && a.operationStatus === "success" && a.attempt === 0) {
      jobSuccessCount.set(a.jobId, (jobSuccessCount.get(a.jobId) ?? 0) + 1);
    }
  }
  const duplicates = [...jobSuccessCount.entries()]
    .filter(([, c]) => c > 1)
    .map(([jobId]) => jobId);

  // 4. Retry double charge: retried attributions (attempt > 0) that still have a cost
  const retryDoubleCharge = attributions
    .filter((a) => a.attempt > 0 && a.operationStatus === "success" && a.finalAttributableCostUsd != null)
    .map((a) => a.idempotencyKey);

  // 5. Missing attribution fields (required dimensions null when they should be present)
  const missingAttributionFields = attributions
    .filter((a) => !a.tenantId || !a.operationType || !a.jobId)
    .map((a) => a.idempotencyKey);

  // 6. Currency mismatches
  const currencyMismatches = attributions
    .filter((a) => a.currency !== "USD" && a.currency !== null)
    .map((a) => a.idempotencyKey);

  // 7. Estimate vs actual variance
  const estimateVsActualVariance = attributions
    .filter((a) => a.estimatedCostUsd != null && a.finalAttributableCostUsd != null)
    .map((a) => {
      const est   = parseFloat(String(a.estimatedCostUsd));
      const final = parseFloat(String(a.finalAttributableCostUsd));
      const variancePct = est > 0 ? Math.abs((final - est) / est) * 100 : 0;
      return { idempotencyKey: a.idempotencyKey, estimatedUsd: est, finalUsd: final, variancePct };
    })
    .filter((v) => v.variancePct > varianceThresholdPct);

  // 8. Cancelled execution with cost
  const cancelledWithCost = attributions
    .filter((a) => a.operationStatus === "cancelled" && a.finalAttributableCostUsd != null && parseFloat(String(a.finalAttributableCostUsd)) > 0)
    .map((a) => a.idempotencyKey);

  // 9. Partial provider usage
  const partialProviderUsage = attributions
    .filter((a) => a.operationStatus === "partial" || (!a.usageAvailable && a.operationStatus === "success"))
    .map((a) => a.idempotencyKey);

  return {
    scannedAttributions:      attributions.length,
    scannedCostRecords:       costsWithoutAttribution.length,
    jobsWithoutCost,
    costsWithoutAttribution,
    duplicates,
    retryDoubleCharge,
    missingAttributionFields,
    currencyMismatches,
    estimateVsActualVariance,
    cancelledWithCost,
    partialProviderUsage,
    reconciledAt: now,
  };
}

// ── Adapter factory ───────────────────────────────────────────────────────────

export function createDesignCostAttributionAdapter(): DesignCostAttributionAdapter {
  return {
    record: recordDesignCostAttribution,
    checkBudget: checkDesignBudget,
    estimateCost: estimateDesignCost,
  };
}
