import { appSchema } from "./_pg-schema";
import {
  serial,
  text,
  integer,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { aiExecutionPlansTable } from "./ai-execution-plans";

export const aiHumanTasksTable = appSchema.table("ai_human_tasks", {
  id: serial("id").primaryKey(),

  // Identity
  taskCode: text("task_code").notNull().unique(),

  // Source — where the human-review request originated
  sourceModule: text("source_module").notNull(),
  // e.g. "creative_ai" | "job_engine" | "workforce" | "client_review" | "scheduler"
  sourceType: text("source_type").notNull(),
  // e.g. "job" | "project" | "employee" | "image" | "invoice"
  sourceId: text("source_id"),

  executionPlanId: integer("execution_plan_id").references(
    () => aiExecutionPlansTable.id,
    { onDelete: "set null" },
  ),

  // Assignment
  assignedDepartment: text("assigned_department"),
  assignedUser: text("assigned_user"),
  assignedRole: text("assigned_role"),
  // Designer | Marketing | Finance | HR | Tax | Legal | Sales | Supervisor | Manager | Administrator

  // Priority 0–100 (higher = more urgent)
  priority: integer("priority").notNull().default(50),

  // Lifecycle
  status: text("status").notNull().default("pending"),
  // pending | assigned | accepted | in_progress | completed | rejected | cancelled | expired

  // Context
  reason: text("reason"),
  instructions: text("instructions"),
  payloadJson: jsonb("payload_json").notNull().default({}),

  // SLA
  dueAt: timestamp("due_at", { withTimezone: true }),
  slaStatus: text("sla_status").notNull().default("on_time"),
  // on_time | warning | overdue | expired

  // Notification hook — integrate Fonnte, WAHA, SMTP, etc. without changing architecture
  notificationHookUrl: text("notification_hook_url"),

  // Timestamps
  acceptedAt:  timestamp("accepted_at",  { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt:   timestamp("created_at",   { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at",   { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AiHumanTask       = typeof aiHumanTasksTable.$inferSelect;
export type InsertAiHumanTask = typeof aiHumanTasksTable.$inferInsert;
