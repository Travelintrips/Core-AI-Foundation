import { appSchema } from "./_pg-schema";
import { serial, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const aiAuditLogsTable = appSchema.table("ai_audit_logs", {
  id: serial("id").primaryKey(),
  module: text("module").notNull(),
  action: text("action").notNull(),
  resourceId: text("resource_id"),
  resourceType: text("resource_type"),
  actorId: text("actor_id"),
  details: jsonb("details"),
  status: text("status").notNull().default("success"),
  ipAddress: text("ip_address"),
  duration: integer("duration"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAiAuditLogSchema = createInsertSchema(aiAuditLogsTable).omit({ id: true, createdAt: true });
export type InsertAiAuditLog = z.infer<typeof insertAiAuditLogSchema>;
export type AiAuditLog = typeof aiAuditLogsTable.$inferSelect;
