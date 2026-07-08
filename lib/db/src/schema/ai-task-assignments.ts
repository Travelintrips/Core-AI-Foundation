import { pgTable, serial, integer, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { aiExecutionPlansTable } from "./ai-execution-plans";
import { aiEmployeesTable } from "./ai-employees";

export const aiTaskAssignmentsTable = pgTable("ai_task_assignments", {
  id: serial("id").primaryKey(),

  executionPlanId: integer("execution_plan_id")
    .notNull()
    .references(() => aiExecutionPlansTable.id, { onDelete: "cascade" }),

  employeeId: integer("employee_id")
    .references(() => aiEmployeesTable.id, { onDelete: "set null" }),

  taskName:        text("task_name").notNull(),
  taskDescription: text("task_description"),

  priority: text("priority").notNull().default("normal"),  // critical | high | normal | low

  // Lifecycle
  status: text("status").notNull().default("pending"),
  // pending | in_progress | completed | failed | cancelled | revision_requested

  assignedAt:  timestamp("assigned_at",  { withTimezone: true }).notNull().defaultNow(),
  startedAt:   timestamp("started_at",   { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),

  retryCount:    integer("retry_count").notNull().default(0),
  revisionCount: integer("revision_count").notNull().default(0),

  output:   jsonb("output"),    // task result payload
  metadata: jsonb("metadata"),  // additional context

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AiTaskAssignment = typeof aiTaskAssignmentsTable.$inferSelect;
export type InsertAiTaskAssignment = typeof aiTaskAssignmentsTable.$inferInsert;
