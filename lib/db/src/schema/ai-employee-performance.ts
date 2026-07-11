import { appSchema } from "./_pg-schema";
import { serial, integer, numeric, boolean, text, timestamp } from "drizzle-orm/pg-core";
import { aiEmployeesTable } from "./ai-employees";

export const aiEmployeePerformanceTable = appSchema.table("ai_employee_performance", {
  id: serial("id").primaryKey(),

  employeeId: integer("employee_id")
    .notNull()
    .unique()
    .references(() => aiEmployeesTable.id, { onDelete: "cascade" }),

  // ── Core metrics ────────────────────────────────────────────────────────────
  completedProjects: integer("completed_projects").notNull().default(0),
  successRate:       numeric("success_rate",   { precision: 5, scale: 2 }).notNull().default("0"),   // 0–100
  averageLatency:    numeric("average_latency", { precision: 10, scale: 2 }),  // ms
  averageCost:       numeric("average_cost",    { precision: 10, scale: 6 }),  // USD per task
  approvalRate:      numeric("approval_rate",  { precision: 5, scale: 2 }).notNull().default("0"),   // 0–100
  revisionRate:      numeric("revision_rate",  { precision: 5, scale: 2 }).notNull().default("0"),   // 0–100
  failureRate:       numeric("failure_rate",   { precision: 5, scale: 2 }).notNull().default("0"),   // 0–100
  qualityScore:      numeric("quality_score",  { precision: 5, scale: 2 }).notNull().default("0"),   // 0–100
  customerRating:    numeric("customer_rating", { precision: 3, scale: 1 }).notNull().default("0"),  // 0–5.0

  // ── Learning Engine (Section 7) ─────────────────────────────────────────────
  experiencePoints:  integer("experience_points").notNull().default(0),
  promotionScore:    numeric("promotion_score", { precision: 5, scale: 2 }).notNull().default("0"),  // 0–100
  trainingRequired:  boolean("training_required").notNull().default(false),
  lastTraining:      timestamp("last_training",  { withTimezone: true }),
  learningNotes:     text("learning_notes"),

  lastUpdated: timestamp("last_updated", { withTimezone: true }).notNull().defaultNow(),
});

export type AiEmployeePerformance = typeof aiEmployeePerformanceTable.$inferSelect;
export type InsertAiEmployeePerformance = typeof aiEmployeePerformanceTable.$inferInsert;
