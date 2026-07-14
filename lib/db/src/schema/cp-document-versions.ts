import { appSchema } from "./_pg-schema";
import { serial, integer, text, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * cp_document_versions — Company Profile V4.2C
 * Tracks every version of a Company Profile document sent for client review.
 * A new row is written each time admin sends a revised document to the customer.
 */
export const cpDocumentVersionsTable = appSchema.table("cp_document_versions", {
  id:             serial("id").primaryKey(),
  projectId:      text("project_id").notNull(),     // UUID → creative_projects.projectId
  reviewId:       integer("review_id"),              // nullable → creative_ai_client_reviews.id
  assetId:        integer("asset_id"),               // nullable → creative_ai_assets.id
  version:        integer("version").notNull().default(1),
  versionLabel:   text("version_label"),             // e.g. "v1", "v2 (Revision)"
  reason:         text("reason"),                    // Why this version was created
  revisionNotes:  text("revision_notes"),            // What changed from the previous version
  sectionsJson:   jsonb("sections_json"),            // MappingGenerationReport.sectionsIncluded
  qcScore:        integer("qc_score"),               // 0–100 from companyProfileQcService
  qcPassed:       boolean("qc_passed"),
  qcDimensionsJson: jsonb("qc_dimensions_json"),     // Per-dimension QC scores
  approved:       boolean("approved").notNull().default(false),
  approvedAt:     timestamp("approved_at", { withTimezone: true }),
  approvedBy:     text("approved_by"),               // Customer name who approved
  sentForReviewAt: timestamp("sent_for_review_at", { withTimezone: true }),
  createdBy:      text("created_by"),                // Admin who sent this version
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertCpDocumentVersionSchema = createInsertSchema(cpDocumentVersionsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});

export type InsertCpDocumentVersion = z.infer<typeof insertCpDocumentVersionSchema>;
export type CpDocumentVersion = typeof cpDocumentVersionsTable.$inferSelect;
