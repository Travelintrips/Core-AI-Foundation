import { appSchema } from "./_pg-schema";
import { serial, integer, text, timestamp, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { creativeAiClientReviewsTable } from "./creative-ai-client-reviews";

/**
 * cp_page_comments — Company Profile V4.2C
 * Enhanced per-page and per-section comments for Company Profile review.
 * Supports threading (parentCommentId), position pinning, section anchoring,
 * priority levels, and admin/client author types.
 */
export const cpPageCommentsTable = appSchema.table("cp_page_comments", {
  id:                serial("id").primaryKey(),
  reviewId:          integer("review_id")
    .notNull()
    .references(() => creativeAiClientReviewsTable.id, { onDelete: "cascade" }),
  projectId:         text("project_id").notNull(),     // UUID
  documentVersionId: integer("document_version_id"),   // nullable → cp_document_versions.id
  parentCommentId:   integer("parent_comment_id"),      // nullable — threaded reply
  // Location
  pageNumber:        integer("page_number"),            // nullable — page-level comment
  positionX:         real("position_x"),               // optional x% on page (0–100)
  positionY:         real("position_y"),               // optional y% on page (0–100)
  sectionId:         text("section_id"),               // optional section identifier
  // Content
  comment:           text("comment").notNull(),
  authorName:        text("author_name").notNull(),
  authorType:        text("author_type").notNull().default("client"), // client | admin
  priority:          text("priority").notNull().default("normal"),     // low | normal | high | urgent
  // Status
  status:            text("status").notNull().default("open"),  // open | resolved | archived
  resolvedBy:        text("resolved_by"),
  resolvedAt:        timestamp("resolved_at", { withTimezone: true }),
  // Timestamps
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertCpPageCommentSchema = createInsertSchema(cpPageCommentsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});

export type InsertCpPageComment = z.infer<typeof insertCpPageCommentSchema>;
export type CpPageComment = typeof cpPageCommentsTable.$inferSelect;
