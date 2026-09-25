import { appSchema } from "./_pg-schema";
import { index, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { aiCodingTasksTable } from "./ai-coding-workspace";

export const aiIncidentsTable = appSchema.table("ai_incidents", {
  id: uuid("id").primaryKey().defaultRandom(),
  fingerprint: text("fingerprint").notNull(),
  source: text("source").notNull(),
  kind: text("kind").notNull(),
  severity: text("severity").notNull().default("warning"),
  riskClass: text("risk_class").notNull().default("GUARDED"),
  status: text("status").notNull().default("OPEN"),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  repository: text("repository"),
  branch: text("branch"),
  headSha: text("head_sha"),
  environment: text("environment").notNull().default("production"),
  metadataJson: jsonb("metadata_json").notNull().default({}),
  repairTaskId: uuid("repair_task_id").references(() => aiCodingTasksTable.id, { onDelete: "set null" }),
  lastError: text("last_error"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, t => [
  uniqueIndex("ai_incidents_fingerprint_uidx").on(t.fingerprint),
  index("ai_incidents_status_source_idx").on(t.status, t.source),
  index("ai_incidents_repo_sha_idx").on(t.repository, t.headSha),
]);
