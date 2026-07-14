/**
 * ai_pipeline_stages — V4.4 Creative Production Pipeline
 * Tracks each individual stage within a pipeline run.
 */
import { appSchema } from "./_pg-schema";
import { serial, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { aiProductionPipelinesTable } from "./ai-production-pipelines";

export const aiPipelineStagesTable = appSchema.table("ai_pipeline_stages", {
  id: serial("id").primaryKey(),
  runId: integer("run_id")
    .notNull()
    .references(() => aiProductionPipelinesTable.id, { onDelete: "cascade" }),
  // creative_director | copywriter | designer | presentation | qa | renderer | customer_review
  stageName: text("stage_name").notNull(),
  stageOrder: integer("stage_order").notNull(),
  // pending | running | completed | failed | skipped | waiting_retry
  status: text("status").notNull().default("pending"),
  input: jsonb("input"),
  output: jsonb("output"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  latencyMs: integer("latency_ms"),
  retryCount: integer("retry_count").notNull().default(0),
  errorMessage: text("error_message"),
  agentSlug: text("agent_slug"),
  model: text("model"),
  provider: text("provider"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiPipelineStageSchema = createInsertSchema(aiPipelineStagesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiPipelineStage = z.infer<typeof insertAiPipelineStageSchema>;
export type AiPipelineStage = typeof aiPipelineStagesTable.$inferSelect;
