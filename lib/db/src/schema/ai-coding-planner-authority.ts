import { appSchema } from "./_pg-schema";
import { bigint, index, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const aiCodingPlannerAuthorityTable = appSchema.table("ai_coding_planner_authority", {
  scope: text("scope").primaryKey(),
  holderId: text("holder_id").notNull(),
  holderType: text("holder_type").notNull(),
  leaseToken: uuid("lease_token").notNull().defaultRandom(),
  fencingGeneration: bigint("fencing_generation", { mode: "number" }).notNull().default(1),
  state: text("state").notNull().default("PRIMARY_ACTIVE"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }).notNull(),
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
  metadataJson: jsonb("metadata_json").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("ai_coding_planner_authority_expiry_idx").on(table.leaseExpiresAt),
  index("ai_coding_planner_authority_holder_idx").on(table.holderId),
]);
