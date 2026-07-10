import { appSchema } from "./_pg-schema";
import {
  serial,
  text,
  integer,
  numeric,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { aiExecutionPlansTable } from "./ai-execution-plans";
import { aiDepartmentsTable } from "./ai-departments";
import { aiEmployeesTable } from "./ai-employees";

export const aiJobsTable = appSchema.table("ai_jobs", {
  id: serial("id").primaryKey(),

  // Identity
  jobCode: text("job_code").notNull().unique(),

  // References (soft — nullable FKs so jobs survive deletions)
  executionPlanId: integer("execution_plan_id").references(
    () => aiExecutionPlansTable.id,
    { onDelete: "set null" },
  ),
  departmentId: integer("department_id").references(
    () => aiDepartmentsTable.id,
    { onDelete: "set null" },
  ),
  employeeId: integer("employee_id").references(
    () => aiEmployeesTable.id,
    { onDelete: "set null" },
  ),

  // Job definition
  jobType: text("job_type").notNull(),
  // e.g. "llm_inference" | "creative_brief" | "image_generation" | "qc_review" | "custom"

  // Priority: base priority (0–100, higher = more urgent) and computed score
  priority:      integer("priority").notNull().default(50),
  priorityScore: numeric("priority_score", { precision: 10, scale: 4 }).default("0"),

  // Lifecycle
  status: text("status").notNull().default("queued"),
  // queued | waiting | running | retrying | completed | failed | cancelled | blocked

  // Payload & result
  payloadJson: jsonb("payload_json").notNull().default({}),
  resultJson:  jsonb("result_json"),

  // Scheduling
  scheduledAt:  timestamp("scheduled_at",  { withTimezone: true }),
  startedAt:    timestamp("started_at",    { withTimezone: true }),
  completedAt:  timestamp("completed_at",  { withTimezone: true }),

  // Retry
  retryCount:    integer("retry_count").notNull().default(0),
  maxRetry:      integer("max_retry").notNull().default(3),
  retryStrategy: text("retry_strategy").notNull().default("exponential"),
  // immediate | exponential | manual
  nextRetryAt:   timestamp("next_retry_at", { withTimezone: true }),

  // Error
  errorMessage: text("error_message"),

  // Cost & duration (ms for duration)
  estimatedCost:     numeric("estimated_cost",     { precision: 12, scale: 6 }),
  actualCost:        numeric("actual_cost",         { precision: 12, scale: 6 }),
  estimatedDuration: integer("estimated_duration"),
  actualDuration:    integer("actual_duration"),

  // Manager priority override (0–100 boost applied on top of base score)
  managerOverride: integer("manager_override"),

  // Capability routing — if set, only workers with this capability can claim
  requiredCapability: text("required_capability"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AiJob = typeof aiJobsTable.$inferSelect;
export type InsertAiJob = typeof aiJobsTable.$inferInsert;
