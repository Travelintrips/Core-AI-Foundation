import { appSchema } from "./_pg-schema";
import { serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { aiServiceRequestsTable } from "./ai-service-catalog";

/**
 * Service-catalog quotations (distinct from legacy creative_project_quotations).
 * Each quotation belongs to an ai_service_request and carries an immutable
 * pricing snapshot once status transitions past "draft".
 *
 * Status machine:
 *   draft → issued → viewed → approved / rejected / revision_requested
 *   Any terminal state (approved | rejected | cancelled | expired) is final.
 */
export const aiQuotationsTable = appSchema.table("ai_quotations", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id"),
  quotationCode: text("quotation_code").notNull().unique(), // e.g. QT-2024-0001
  serviceRequestId: integer("service_request_id").references(
    () => aiServiceRequestsTable.id,
    { onDelete: "set null" },
  ),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  currency: text("currency").notNull().default("IDR"),
  subtotal: integer("subtotal").notNull().default(0),
  discount: integer("discount").notNull().default(0),
  tax: integer("tax").notNull().default(0),
  total: integer("total").notNull().default(0),
  // Immutable once status = issued
  pricingSnapshotJson: jsonb("pricing_snapshot_json"),
  scopeSnapshotJson: jsonb("scope_snapshot_json"),
  termsSnapshotJson: jsonb("terms_snapshot_json"),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  // status: draft | issued | viewed | approved | rejected | revision_requested | expired | cancelled
  status: text("status").notNull().default("draft"),
  // Token stored as SHA-256 hash — plaintext never persisted
  reviewTokenHash: text("review_token_hash").unique(),
  reviewTokenExpiresAt: timestamp("review_token_expires_at", { withTimezone: true }),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  viewedAt: timestamp("viewed_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  revisionRequestedAt: timestamp("revision_requested_at", { withTimezone: true }),
  revisionNotes: text("revision_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  // WP-09: soft-delete columns — NULL = not deleted (stays nullable forever by design)
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: text("deleted_by"), // actorId: internal user id or customer profile id
});

export const insertAiQuotationSchema = createInsertSchema(aiQuotationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiQuotation = z.infer<typeof insertAiQuotationSchema>;
export type AiQuotation = typeof aiQuotationsTable.$inferSelect;

/** Terminal states — once reached, no further transitions are allowed. */
export const AI_QUOTATION_TERMINAL_STATES = new Set([
  "approved",
  "rejected",
  "cancelled",
  "expired",
]);
