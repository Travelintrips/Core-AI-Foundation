import { appSchema } from "./_pg-schema";
import {
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { aiCodingTasksTable } from "./ai-coding-workspace";

export const CODING_GRAPH_STATUSES = [
  "PREPARED",
  "APPROVED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export const CODING_WORKSTREAM_STATUSES = [
  "PENDING",
  "READY",
  "CLAIMED",
  "RUNNING",
  "REVIEW_REQUIRED",
  "BLOCKED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type CodingGraphStatus = (typeof CODING_GRAPH_STATUSES)[number];
export type CodingWorkstreamStatus =
  (typeof CODING_WORKSTREAM_STATUSES)[number];

export const aiCodingTaskGraphsTable = appSchema.table(
  "ai_coding_task_graphs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => aiCodingTasksTable.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    contractVersion: integer("contract_version").notNull().default(1),
    planHash: text("plan_hash").notNull(),
    objective: text("objective").notNull(),
    status: text("status").notNull().default("PREPARED"),
    planJson: jsonb("plan_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("ai_coding_task_graphs_task_version_uidx").on(
      table.taskId,
      table.version,
    ),
    index("ai_coding_task_graphs_task_idx").on(table.taskId),
    index("ai_coding_task_graphs_status_idx").on(table.status),
  ],
);

export const aiCodingWorkstreamsTable = appSchema.table(
  "ai_coding_workstreams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    graphId: uuid("graph_id")
      .notNull()
      .references(() => aiCodingTaskGraphsTable.id, { onDelete: "cascade" }),
    workstreamKey: text("workstream_key").notNull(),
    title: text("title").notNull(),
    role: text("role").notNull(),
    instruction: text("instruction").notNull(),
    status: text("status").notNull().default("PENDING"),
    priority: integer("priority").notNull().default(50),
    ownershipPaths: jsonb("ownership_paths").notNull().default([]),
    acceptanceCriteria: jsonb("acceptance_criteria").notNull().default([]),
    verificationProfiles: jsonb("verification_profiles").notNull().default([]),
    workerId: text("worker_id"),
    leaseToken: text("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    branchName: text("branch_name"),
    baseSha: text("base_sha"),
    headSha: text("head_sha"),
    attemptCount: integer("attempt_count").notNull().default(0),
    resultJson: jsonb("result_json"),
    errorMessage: text("error_message"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("ai_coding_workstreams_graph_key_uidx").on(
      table.graphId,
      table.workstreamKey,
    ),
    index("ai_coding_workstreams_graph_idx").on(table.graphId),
    index("ai_coding_workstreams_status_idx").on(table.status),
  ],
);

export const aiCodingWorkstreamDependenciesTable = appSchema.table(
  "ai_coding_workstream_dependencies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    graphId: uuid("graph_id")
      .notNull()
      .references(() => aiCodingTaskGraphsTable.id, { onDelete: "cascade" }),
    workstreamId: uuid("workstream_id")
      .notNull()
      .references(() => aiCodingWorkstreamsTable.id, { onDelete: "cascade" }),
    dependsOnWorkstreamId: uuid("depends_on_workstream_id")
      .notNull()
      .references(() => aiCodingWorkstreamsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("ai_coding_workstream_dependencies_pair_uidx").on(
      table.workstreamId,
      table.dependsOnWorkstreamId,
    ),
    index("ai_coding_workstream_dependencies_graph_idx").on(table.graphId),
    index("ai_coding_workstream_dependencies_workstream_idx").on(
      table.workstreamId,
    ),
  ],
);

export type AiCodingTaskGraph = typeof aiCodingTaskGraphsTable.$inferSelect;
export type InsertAiCodingTaskGraph =
  typeof aiCodingTaskGraphsTable.$inferInsert;
export type AiCodingWorkstream = typeof aiCodingWorkstreamsTable.$inferSelect;
export type InsertAiCodingWorkstream =
  typeof aiCodingWorkstreamsTable.$inferInsert;
export type AiCodingWorkstreamDependency =
  typeof aiCodingWorkstreamDependenciesTable.$inferSelect;
