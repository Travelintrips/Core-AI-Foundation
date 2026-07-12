import { appSchema } from "./_pg-schema";
import { serial, text, timestamp, integer, numeric, index } from "drizzle-orm/pg-core";

/**
 * ai_workflow_costs — aggregated cost per workflow execution.
 * Written once when a workflow/job batch completes.
 */
export const aiWorkflowCostsTable = appSchema.table(
  "ai_workflow_costs",
  {
    id: serial("id").primaryKey(),

    // ── Scope ────────────────────────────────────────────────────────────
    workflowId: integer("workflow_id"),   // ai_workflows.id (nullable for ad-hoc jobs)
    jobId:      integer("job_id"),        // ai_jobs.id (for single-job workflows)
    orderId:    text("order_id"),         // service request / commercial order ref
    companyId:  text("company_id"),       // future multi-tenant

    // ── Aggregates ───────────────────────────────────────────────────────
    totalAgents:           integer("total_agents").notNull().default(0),
    totalPromptTokens:     integer("total_prompt_tokens").notNull().default(0),
    totalCompletionTokens: integer("total_completion_tokens").notNull().default(0),
    totalTokens:           integer("total_tokens").notNull().default(0),
    totalCostUsd:          numeric("total_cost_usd", { precision: 14, scale: 8 }),
    processingTimeMs:      integer("processing_time_ms"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_workflow_costs_workflow_id_idx").on(t.workflowId),
    index("ai_workflow_costs_order_id_idx").on(t.orderId),
    index("ai_workflow_costs_created_at_idx").on(t.createdAt),
  ],
);

export type AiWorkflowCost = typeof aiWorkflowCostsTable.$inferSelect;
export type InsertAiWorkflowCost = typeof aiWorkflowCostsTable.$inferInsert;
