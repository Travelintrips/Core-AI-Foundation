import { appSchema } from "./_pg-schema";
import { index, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { aiCodingTasksTable } from "./ai-coding-workspace";

export const aiCodingBridgeCommandsTable = appSchema.table("ai_coding_bridge_commands", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").references(() => aiCodingTasksTable.id, { onDelete: "set null" }),
  externalCommandId: text("external_command_id").notNull(),
  source: text("source").notNull().default("chatgpt"),
  commandType: text("command_type").notNull().default("INSTRUCTION"),
  instruction: text("instruction").notNull(),
  authorityJson: jsonb("authority_json").notNull().default({}),
  metadataJson: jsonb("metadata_json").notNull().default({}),
  status: text("status").notNull().default("RECEIVED"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("ai_coding_bridge_commands_external_uidx").on(table.source, table.externalCommandId),
  index("ai_coding_bridge_commands_task_idx").on(table.taskId),
  index("ai_coding_bridge_commands_status_idx").on(table.status),
]);

export const aiCodingBridgeResponsesTable = appSchema.table("ai_coding_bridge_responses", {
  id: uuid("id").primaryKey().defaultRandom(),
  commandId: uuid("command_id").notNull().references(() => aiCodingBridgeCommandsTable.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").references(() => aiCodingTasksTable.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  message: text("message").notNull(),
  checkpointJson: jsonb("checkpoint_json").notNull().default({}),
  metadataJson: jsonb("metadata_json").notNull().default({}),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("ai_coding_bridge_responses_command_idx").on(table.commandId),
  index("ai_coding_bridge_responses_task_idx").on(table.taskId),
  index("ai_coding_bridge_responses_ack_idx").on(table.acknowledgedAt),
]);

export const aiCodingBridgePresenceTable = appSchema.table("ai_coding_bridge_presence", {
  clientId: text("client_id").primaryKey(),
  source: text("source").notNull().default("chatgpt"),
  leaseToken: uuid("lease_token").notNull().defaultRandom(),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  metadataJson: jsonb("metadata_json").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [index("ai_coding_bridge_presence_expiry_idx").on(table.leaseExpiresAt)]);
