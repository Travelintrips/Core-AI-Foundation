import { appSchema } from "./_pg-schema";
import { boolean, index, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const aiAgentServiceTokensTable = appSchema.table("ai_agent_service_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  scopes: text("scopes").array().notNull(),
  isActive: boolean("is_active").notNull().default(true),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("ai_agent_service_tokens_name_uidx").on(table.name),
  uniqueIndex("ai_agent_service_tokens_hash_uidx").on(table.tokenHash),
  index("ai_agent_service_tokens_active_idx").on(table.isActive),
]);
