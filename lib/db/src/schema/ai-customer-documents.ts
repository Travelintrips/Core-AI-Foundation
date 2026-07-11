import { appSchema } from "./_pg-schema";
import { serial, text, integer, bigint, timestamp, jsonb, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * ai_customer_documents — Server-generated PDF documents for customers.
 *
 * document_type: deposit_invoice | remaining_invoice | final_invoice |
 *                payment_receipt | quotation | delivery_package
 * status:        draft | generating | issued | voided
 *
 * storage_path is never returned to the client; signed URLs are issued instead.
 * idempotency: (customer_id, service_request_id, document_type, document_number) is unique
 * so re-generating the same document bumps a version instead of duplicating.
 */
export const aiCustomerDocumentsTable = appSchema.table(
  "ai_customer_documents",
  {
    id: serial("id").primaryKey(),
    customerId: text("customer_id").notNull(), // email_hash of the customer
    clientEmail: text("client_email").notNull(),
    projectId: text("project_id"), // creative_projects.project_id (nullable)
    serviceRequestId: text("service_request_id"), // ai_service_requests.request_id (nullable)
    quotationId: integer("quotation_id"), // ai_quotations.id (nullable)
    paymentScheduleId: integer("payment_schedule_id"), // ai_payment_schedule.id (nullable)
    documentType: text("document_type").notNull(), // deposit_invoice | remaining_invoice | final_invoice | payment_receipt | quotation | delivery_package
    documentNumber: text("document_number").notNull(), // human-readable doc number e.g. INV-2026-001
    fileName: text("file_name").notNull(),
    storagePath: text("storage_path").notNull(), // internal path — never exposed to client
    mimeType: text("mime_type").notNull().default("application/pdf"),
    fileSize: bigint("file_size", { mode: "number" }), // bytes
    status: text("status").notNull().default("draft"), // draft | generating | issued | voided
    snapshotJson: jsonb("snapshot_json").$type<Record<string, unknown>>(), // invoice data snapshot
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    // Idempotency: same customer + document_number cannot be duplicated
    uniqDocNumber: unique("uq_customer_doc_number").on(t.customerId, t.documentNumber),
  }),
);

export const insertAiCustomerDocumentSchema = createInsertSchema(aiCustomerDocumentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiCustomerDocument = z.infer<typeof insertAiCustomerDocumentSchema>;
export type AiCustomerDocument = typeof aiCustomerDocumentsTable.$inferSelect;
