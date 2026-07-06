import { pgTable, serial, text, boolean, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const aiWorkflowsTable = pgTable("ai_workflows", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("draft"),
  steps: jsonb("steps").notNull().default([]),
  triggerType: text("trigger_type"),
  triggerConfig: jsonb("trigger_config"),
  defaultModelId: integer("default_model_id"),
  tags: text("tags").array().notNull().default([]),
  executionCount: integer("execution_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiWorkflowSchema = createInsertSchema(aiWorkflowsTable).omit({ id: true, createdAt: true, updatedAt: true, executionCount: true });
export type InsertAiWorkflow = z.infer<typeof insertAiWorkflowSchema>;
export type AiWorkflow = typeof aiWorkflowsTable.$inferSelect;
