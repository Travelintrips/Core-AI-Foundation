import { appSchema } from "./_pg-schema";
import { serial, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * ai_audit_logs — canonical, append-only audit trail (P0-3 / WP-07 + WP-08).
 *
 * `tenantId` and `actorType` were added additively (nullable) so every
 * pre-existing row and every legacy `logAudit(...)` call site keeps working
 * unmodified — see services/aiAuditService.ts and services/audit/auditTypes.ts
 * for the write-side contract. This table has no update/delete path at the
 * application layer; see aiAuditService.ts's `updateAuditLog`/`deleteAuditLog`
 * guards and docs/implementation/wp03-audit-log-report.md for the immutability
 * rationale.
 */
export const aiAuditLogsTable = appSchema.table("ai_audit_logs", {
  id: serial("id").primaryKey(),
  module: text("module").notNull(),
  action: text("action").notNull(),
  resourceId: text("resource_id"),
  resourceType: text("resource_type"),
  actorId: text("actor_id"),
  /** Nullable: legacy rows and platform-wide/system events have no single owning tenant. */
  tenantId: text("tenant_id"),
  /** Nullable: coarse actor category — see AUDIT_ACTOR_TYPES in services/audit/auditTypes.ts. */
  actorType: text("actor_type"),
  details: jsonb("details"),
  status: text("status").notNull().default("success"),
  ipAddress: text("ip_address"),
  duration: integer("duration"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAiAuditLogSchema = createInsertSchema(aiAuditLogsTable).omit({ id: true, createdAt: true });
export type InsertAiAuditLog = z.infer<typeof insertAiAuditLogSchema>;
export type AiAuditLog = typeof aiAuditLogsTable.$inferSelect;
