import { pgTable, serial, text, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Cost Records — granular per-request cost tracking.
 * Records every AI execution with token counts, estimated cost, latency, and retry metadata.
 * Supports cost aggregation per: request, workflow, project, client, agent, provider.
 */
export const aiCostRecordsTable = pgTable("ai_cost_records", {
  id: serial("id").primaryKey(),
  // Scope identifiers
  projectId: text("project_id"),          // Creative project UUID (string)
  stepId: integer("step_id"),             // creative_project_steps.id
  workflowId: integer("workflow_id"),     // ai_workflows.id
  clientId: text("client_id"),            // Brand name / external client ID
  agentSlug: text("agent_slug"),          // Which agent executed (e.g., "brand-strategist")
  // Model details
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  // Token accounting
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  // Cost in USD (8 decimal places for micro-pricing)
  estimatedCostUsd: numeric("estimated_cost_usd", { precision: 12, scale: 8 }),
  actualCostUsd: numeric("actual_cost_usd", { precision: 12, scale: 8 }),
  // Performance
  latencyMs: integer("latency_ms"),
  retryCount: integer("retry_count").notNull().default(0),
  fallbackCount: integer("fallback_count").notNull().default(0),
  status: text("status").notNull().default("success"), // success | failed | partial
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAiCostRecordSchema = createInsertSchema(aiCostRecordsTable).omit({ id: true, createdAt: true });
export type InsertAiCostRecord = z.infer<typeof insertAiCostRecordSchema>;
export type AiCostRecord = typeof aiCostRecordsTable.$inferSelect;
