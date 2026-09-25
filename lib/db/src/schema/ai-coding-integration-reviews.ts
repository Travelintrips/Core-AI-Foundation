import { appSchema } from "./_pg-schema";
import {
  index,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { aiCodingTaskGraphsTable } from "./ai-coding-task-graph";
import { aiCodingTasksTable } from "./ai-coding-workspace";

export const CODING_INTEGRATION_REVIEW_STATUSES = [
  "APPROVED",
  "VERIFIED",
  "FAILED",
] as const;

export const aiCodingIntegrationReviewsTable = appSchema.table(
  "ai_coding_integration_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => aiCodingTasksTable.id, { onDelete: "cascade" }),
    graphId: uuid("graph_id")
      .notNull()
      .references(() => aiCodingTaskGraphsTable.id, { onDelete: "cascade" }),
    manifestHash: text("manifest_hash").notNull(),
    status: text("status").notNull().default("APPROVED"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verificationJson: jsonb("verification_json"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("ai_coding_integration_reviews_graph_manifest_uidx").on(
      table.graphId,
      table.manifestHash,
    ),
    index("ai_coding_integration_reviews_task_idx").on(table.taskId),
    index("ai_coding_integration_reviews_graph_idx").on(table.graphId),
    index("ai_coding_integration_reviews_status_idx").on(table.status),
  ],
);

export type AiCodingIntegrationReview =
  typeof aiCodingIntegrationReviewsTable.$inferSelect;
export type InsertAiCodingIntegrationReview =
  typeof aiCodingIntegrationReviewsTable.$inferInsert;
