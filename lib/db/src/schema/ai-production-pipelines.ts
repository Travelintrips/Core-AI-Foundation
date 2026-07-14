/**
 * ai_production_pipelines — V4.4 Creative Production Pipeline
 * Tracks one end-to-end pipeline run per creative project.
 */
import { appSchema } from "./_pg-schema";
import { serial, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { creativeProjectsTable } from "./creative-projects";

export const aiProductionPipelinesTable = appSchema.table("ai_production_pipelines", {
  id: serial("id").primaryKey(),
  runId: text("run_id").notNull().unique(), // UUID string — client-facing ID
  projectId: integer("project_id")
    .notNull()
    .references(() => creativeProjectsTable.id, { onDelete: "cascade" }),
  // pending | running | completed | failed | cancelled
  status: text("status").notNull().default("pending"),
  currentStage: text("current_stage"), // which stage is actively running
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").notNull().default(0),
  // aggregated runtime stats: { totalStages, completed, failed, skipped, totalLatencyMs, ... }
  executionSummary: jsonb("execution_summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiProductionPipelineSchema = createInsertSchema(aiProductionPipelinesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiProductionPipeline = z.infer<typeof insertAiProductionPipelineSchema>;
export type AiProductionPipeline = typeof aiProductionPipelinesTable.$inferSelect;
