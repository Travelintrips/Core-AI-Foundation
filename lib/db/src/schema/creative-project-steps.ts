import { pgTable, serial, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { creativeProjectsTable } from "./creative-projects";
import { aiAgentsTable } from "./ai-agents";

export const creativeProjectStepsTable = pgTable("creative_project_steps", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => creativeProjectsTable.id, { onDelete: "cascade" }),
  agentId: integer("agent_id").references(() => aiAgentsTable.id, { onDelete: "set null" }),
  stepName: text("step_name").notNull(),
  input: jsonb("input"),
  output: jsonb("output"),
  provider: text("provider"),
  model: text("model"),
  tokenUsage: integer("token_usage").notNull().default(0),
  latencyMs: integer("latency_ms"),
  status: text("status").notNull().default("pending"), // pending | running | completed | failed
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCreativeProjectStepSchema = createInsertSchema(creativeProjectStepsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCreativeProjectStep = z.infer<typeof insertCreativeProjectStepSchema>;
export type CreativeProjectStep = typeof creativeProjectStepsTable.$inferSelect;
