import { appSchema } from "./_pg-schema";
import { uuid, text, integer, timestamp } from "drizzle-orm/pg-core";

export const CODING_TASK_STATUSES = [
  "PENDING",
  "ANALYZING",
  "CODING",
  "TESTING",
  "COMMITTING",
  "PR_CREATED",
  "READY_REVIEW",
  "COMPLETED",
  "FAILED",
] as const;

export type CodingTaskStatus = (typeof CODING_TASK_STATUSES)[number];

export const CODING_RUN_STATUSES = ["PENDING", "RUNNING", "COMPLETED", "FAILED"] as const;
export type CodingRunStatus = (typeof CODING_RUN_STATUSES)[number];

export const CODING_CHANGE_TYPES = ["ADDED", "MODIFIED", "DELETED", "RENAMED"] as const;
export type CodingChangeType = (typeof CODING_CHANGE_TYPES)[number];

export const aiCodingTasksTable = appSchema.table("ai_coding_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskNumber: text("task_number").notNull().unique(),
  projectName: text("project_name").notNull(),
  repository: text("repository").notNull(),
  branch: text("branch").notNull(),
  instruction: text("instruction").notNull(),
  status: text("status").notNull().default("PENDING"),
  priority: integer("priority").notNull().default(50),
  resultSummary: text("result_summary"),
  commitSha: text("commit_sha"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const aiCodingRunsTable = appSchema.table("ai_coding_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull().references(() => aiCodingTasksTable.id, { onDelete: "cascade" }),
  agentName: text("agent_name").notNull(),
  status: text("status").notNull().default("PENDING"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  logs: text("logs"),
  errorMessage: text("error_message"),
});

export const aiCodeChangesTable = appSchema.table("ai_code_changes", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull().references(() => aiCodingTasksTable.id, { onDelete: "cascade" }),
  filePath: text("file_path").notNull(),
  changeType: text("change_type").notNull(),
  commitSha: text("commit_sha"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AiCodingTask = typeof aiCodingTasksTable.$inferSelect;
export type InsertAiCodingTask = typeof aiCodingTasksTable.$inferInsert;
export type AiCodingRun = typeof aiCodingRunsTable.$inferSelect;
export type AiCodeChange = typeof aiCodeChangesTable.$inferSelect;