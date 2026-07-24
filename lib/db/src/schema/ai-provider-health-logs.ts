import { appSchema } from "./_pg-schema";
import { serial, integer, boolean, text, timestamp } from "drizzle-orm/pg-core";
import { aiProvidersTable } from "./ai-providers";

export const aiProviderHealthLogsTable = appSchema.table("ai_provider_health_logs", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id")
    .notNull()
    .references(() => aiProvidersTable.id, { onDelete: "cascade" }),
  isActive: boolean("is_active").notNull(),
  httpStatus: integer("http_status"),
  error: text("error"),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AiProviderHealthLog = typeof aiProviderHealthLogsTable.$inferSelect;
export type InsertAiProviderHealthLog = typeof aiProviderHealthLogsTable.$inferInsert;
