import { pgTable, serial, text, integer, numeric, timestamp } from "drizzle-orm/pg-core";

export const aiExecutionPlansTable = pgTable("ai_execution_plans", {
  id: serial("id").primaryKey(),

  // Link to project (any type — 'creative_ai', 'custom', etc.)
  projectId:   text("project_id"),         // nullable — e.g. creative_projects.project_id
  projectType: text("project_type").notNull().default("creative_ai"),

  // Plan details
  objective:         text("objective").notNull(),
  department:        text("department").notNull(),           // department code
  managerEmployeeId: integer("manager_employee_id"),         // FK ai_employees (soft)

  // Scheduling
  priority: text("priority").notNull().default("normal"),   // critical | high | normal | low

  // Lifecycle
  status: text("status").notNull().default("draft"),        // draft | active | completed | failed | cancelled

  // Cost / time tracking
  estimatedCost:     numeric("estimated_cost", { precision: 12, scale: 4 }),
  estimatedDuration: integer("estimated_duration"),           // minutes
  actualCost:        numeric("actual_cost", { precision: 12, scale: 4 }),
  actualDuration:    integer("actual_duration"),              // minutes

  startedAt:   timestamp("started_at",   { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt:   timestamp("created_at",   { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at",   { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AiExecutionPlan = typeof aiExecutionPlansTable.$inferSelect;
export type InsertAiExecutionPlan = typeof aiExecutionPlansTable.$inferInsert;
