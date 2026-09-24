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
import {
  aiCodingTaskGraphsTable,
  aiCodingWorkstreamsTable,
} from "./ai-coding-task-graph";

export const CODING_WORKSTREAM_AI_HANDOFF_STATUSES = [
  "PREPARED",
  "APPROVED",
  "CONSUMED",
  "REVOKED",
] as const;

export type CodingWorkstreamAiHandoffStatus =
  (typeof CODING_WORKSTREAM_AI_HANDOFF_STATUSES)[number];

export const aiCodingWorkstreamAiHandoffsTable = appSchema.table(
  "ai_coding_workstream_ai_handoffs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    graphId: uuid("graph_id")
      .notNull()
      .references(() => aiCodingTaskGraphsTable.id, { onDelete: "cascade" }),
    workstreamId: uuid("workstream_id")
      .notNull()
      .references(() => aiCodingWorkstreamsTable.id, { onDelete: "cascade" }),
    claimAttempt: integer("claim_attempt").notNull(),
    packageVersion: integer("package_version").notNull().default(1),
    packageHash: text("package_hash").notNull(),
    planHash: text("plan_hash").notNull(),
    baseSha: text("base_sha").notNull(),
    status: text("status").notNull().default("PREPARED"),
    packageJson: jsonb("package_json").notNull(),
    preparedAt: timestamp("prepared_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    consumedExecutionId: text("consumed_execution_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("ai_coding_workstream_ai_handoffs_attempt_uidx").on(
      table.workstreamId,
      table.claimAttempt,
    ),
    index("ai_coding_workstream_ai_handoffs_graph_idx").on(table.graphId),
    index("ai_coding_workstream_ai_handoffs_status_idx").on(table.status),
    index("ai_coding_workstream_ai_handoffs_expires_idx").on(table.expiresAt),
  ],
);

export type AiCodingWorkstreamAiHandoff =
  typeof aiCodingWorkstreamAiHandoffsTable.$inferSelect;
export type InsertAiCodingWorkstreamAiHandoff =
  typeof aiCodingWorkstreamAiHandoffsTable.$inferInsert;
