import { pgTable, serial, integer, text, numeric, timestamp, jsonb } from "drizzle-orm/pg-core";

export const aiDecisionLogsTable = pgTable("ai_decision_logs", {
  id: serial("id").primaryKey(),

  executionPlanId: integer("execution_plan_id"),  // soft FK to ai_execution_plans

  // Who made this decision
  decisionBy: text("decision_by").notNull(),
  // 'ai_ceo' | 'manager' | 'system' | 'supervisor' | 'qc'

  // What was decided
  decisionType: text("decision_type").notNull(),
  // 'department_selection' | 'manager_selection' | 'employee_selection'
  // | 'task_assignment' | 'approval' | 'rejection' | 'revision' | 'rebalance'

  reason:             text("reason"),
  selectedEmployee:   text("selected_employee"),
  selectedDepartment: text("selected_department"),
  selectedProvider:   text("selected_provider"),
  selectedModel:      text("selected_model"),
  score:              numeric("score", { precision: 5, scale: 2 }),
  metadata:           jsonb("metadata"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AiDecisionLog = typeof aiDecisionLogsTable.$inferSelect;
export type InsertAiDecisionLog = typeof aiDecisionLogsTable.$inferInsert;
