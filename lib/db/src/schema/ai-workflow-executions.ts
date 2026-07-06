import { pgTable, serial, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { aiWorkflowsTable } from "./ai-workflows";

export const aiWorkflowExecutionsTable = pgTable("ai_workflow_executions", {
  id: serial("id").primaryKey(),
  workflowId: integer("workflow_id").notNull().references(() => aiWorkflowsTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  inputs: jsonb("inputs"),
  outputs: jsonb("outputs"),
  stepResults: jsonb("step_results"),
  errorMessage: text("error_message"),
  tokensUsed: integer("tokens_used"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const insertAiWorkflowExecutionSchema = createInsertSchema(aiWorkflowExecutionsTable).omit({ id: true, createdAt: true });
export type InsertAiWorkflowExecution = z.infer<typeof insertAiWorkflowExecutionSchema>;
export type AiWorkflowExecution = typeof aiWorkflowExecutionsTable.$inferSelect;
