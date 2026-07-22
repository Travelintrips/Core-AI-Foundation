/**
 * design-cost-attribution.ts — Team 34: Design Cost, Usage, and Budget Attribution
 *
 * Two additive tables:
 *   1. design_cost_attributions  — extends ai_cost_records with full design-execution
 *      attribution dimensions + rich usage/cost fields. Linked via cost_record_id (nullable
 *      so an attribution row can be created before the underlying cost record exists, e.g.
 *      on cancellation before any tokens are billed).
 *
 *   2. design_budget_policies — per-scope budget rules (soft-warn / hard-block /
 *      require-approval) applied at tenant / project / order / workflow / stage / capability.
 *
 * Design invariants:
 *   - Never duplicates the core cost ledger (ai_cost_records remains the source of truth
 *     for raw token + cost data).
 *   - idempotencyKey is UNIQUE — prevents duplicate attribution rows for the same execution.
 *   - No AI provider, model, tenant, or domain is hard-coded here.
 *   - All nullable usage fields use null to explicitly signal "not available from provider"
 *     rather than defaulting to 0, which would imply 0 was reported.
 */

import { appSchema } from "./_pg-schema";
import {
  serial,
  integer,
  text,
  timestamp,
  numeric,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ── 1. design_cost_attributions ───────────────────────────────────────────────

export const designCostAttributionsTable = appSchema.table(
  "design_cost_attributions",
  {
    id: serial("id").primaryKey(),

    // ── Link to existing cost ledger ──────────────────────────────────────────
    // Nullable: attribution row may be created on cancellation before any
    // ai_cost_records row exists.
    costRecordId: integer("cost_record_id"),

    // ── Idempotency ───────────────────────────────────────────────────────────
    // jobId + attempt combination used as the natural idempotency key.
    // Enforced UNIQUE to prevent double-attribution on retries.
    idempotencyKey: text("idempotency_key").notNull(),

    // ── Attribution dimensions ────────────────────────────────────────────────
    tenantId:     text("tenant_id").notNull(),
    projectId:    text("project_id"),
    orderId:      text("order_id"),
    workflowId:   text("workflow_id"),
    stageId:      text("stage_id"),
    artifactId:   text("artifact_id"),
    capabilityId: text("capability_id"),
    pluginId:     text("plugin_id"),
    agentId:      text("agent_id"),
    jobId:        text("job_id"),
    attempt:      integer("attempt").notNull().default(0),
    providerId:   text("provider_id"),
    modelId:      text("model_id"),
    operationType: text("operation_type").notNull(), // e.g. "text_generation" | "image_generation" | "render" | "export" | "qc"
    correlationId: text("correlation_id"),

    // ── Token usage (null = not available / not reported by provider) ─────────
    inputTokens:  integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cachedTokens: integer("cached_tokens"),   // prompt-cache hits where supported

    // ── Other usage dimensions ────────────────────────────────────────────────
    imageGenerationCount: integer("image_generation_count"),
    renderCount:          integer("render_count"),
    runtimeSeconds:       numeric("runtime_seconds", { precision: 12, scale: 3 }),
    storageBytes:         integer("storage_bytes"),
    requestCount:         integer("request_count").notNull().default(1),
    retryCount:           integer("retry_count").notNull().default(0),

    // ── Cost fields ───────────────────────────────────────────────────────────
    // estimatedCostUsd     = pre-execution estimate from pricing table
    // providerReportedUsd  = cost as reported in provider response (null if unavailable)
    // calculatedCostUsd    = token * rate from canonical pricing
    // adjustedCostUsd      = after discount / credit / promotion
    // finalAttributableUsd = the figure that counts toward budget consumption
    estimatedCostUsd:      numeric("estimated_cost_usd",      { precision: 12, scale: 8 }),
    providerReportedCostUsd: numeric("provider_reported_cost_usd", { precision: 12, scale: 8 }),
    calculatedCostUsd:     numeric("calculated_cost_usd",     { precision: 12, scale: 8 }),
    adjustedCostUsd:       numeric("adjusted_cost_usd",       { precision: 12, scale: 8 }),
    finalAttributableCostUsd: numeric("final_attributable_cost_usd", { precision: 12, scale: 8 }),

    currency:         text("currency").notNull().default("USD"),
    pricingVersion:   text("pricing_version"),  // e.g. "2024-01-01" or pricing row id
    pricingSource:    text("pricing_source"),   // "ai_provider_pricing" | "manual" | "default_fallback"
    pricingCalculatedAt: timestamp("pricing_calculated_at", { withTimezone: true }),

    // ── Execution outcome ─────────────────────────────────────────────────────
    operationStatus: text("operation_status").notNull().default("success"),
    // "pending" | "running" | "success" | "failed" | "cancelled" | "partial"

    // Explicit flag: false means usage data was unavailable from provider
    // (not that usage was zero). Consumers MUST check this before treating
    // null usage fields as "zero usage".
    usageAvailable: boolean("usage_available").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("design_cost_attributions_idempotency_key_idx").on(t.idempotencyKey),
    index("design_cost_attributions_tenant_idx").on(t.tenantId),
    index("design_cost_attributions_project_idx").on(t.projectId),
    index("design_cost_attributions_order_idx").on(t.orderId),
    index("design_cost_attributions_job_idx").on(t.jobId),
    index("design_cost_attributions_created_at_idx").on(t.createdAt),
  ],
);

export type DesignCostAttributionRow = typeof designCostAttributionsTable.$inferSelect;
export type InsertDesignCostAttribution = typeof designCostAttributionsTable.$inferInsert;

// ── 2. design_budget_policies ─────────────────────────────────────────────────

export const designBudgetPoliciesTable = appSchema.table(
  "design_budget_policies",
  {
    id: serial("id").primaryKey(),

    // ── Tenant isolation ──────────────────────────────────────────────────────
    tenantId: text("tenant_id").notNull(),

    // ── Scope ─────────────────────────────────────────────────────────────────
    // scopeType determines the semantic of scopeId:
    //   "tenant"     → scopeId = tenantId (whole-tenant budget)
    //   "project"    → scopeId = projectId
    //   "order"      → scopeId = orderId
    //   "workflow"   → scopeId = workflowId
    //   "stage"      → scopeId = stageId
    //   "capability" → scopeId = capabilityId
    scopeType: text("scope_type").notNull(),  // tenant | project | order | workflow | stage | capability
    scopeId:   text("scope_id").notNull(),

    // ── Policy ────────────────────────────────────────────────────────────────
    limitType: text("limit_type").notNull(),   // per_run | daily | monthly
    actionType: text("action_type").notNull(), // soft_warn | hard_block | require_approval

    limitAmountUsd:      numeric("limit_amount_usd", { precision: 12, scale: 4 }).notNull(),
    warningThresholdPct: integer("warning_threshold_pct").notNull().default(80),
    // Percentage of limitAmountUsd at which a soft_warn is emitted (even when
    // actionType is hard_block — the warning fires first).

    currency: text("currency").notNull().default("USD"),
    active:   boolean("active").notNull().default(true),

    description: text("description"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("design_budget_policies_tenant_idx").on(t.tenantId),
    index("design_budget_policies_scope_idx").on(t.scopeType, t.scopeId),
    index("design_budget_policies_active_idx").on(t.active),
  ],
);

export type DesignBudgetPolicyRow = typeof designBudgetPoliciesTable.$inferSelect;
export type InsertDesignBudgetPolicy = typeof designBudgetPoliciesTable.$inferInsert;
