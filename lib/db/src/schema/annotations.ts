/**
 * annotations.ts — Team 18 / Universal Annotation and Comment System
 *
 * Tables:
 *   ai_annotations       — annotation pins, rectangles, and region markers
 *   ai_annotation_comments — threaded comments attached to an annotation
 *
 * Design decisions:
 *   - geometry stored as JSONB with normalized coordinates (0–1) so they
 *     survive viewport / resolution changes without loss.
 *   - tenantId comes exclusively from the authenticated request context —
 *     never from client-supplied fields.
 *   - actor identity (createdBy, createdByName) is set server-side only.
 *   - status lifecycle is separate from the client-review decision.
 *   - soft-delete (isDeleted flag) is used; rows are never hard-deleted by
 *     normal API calls so audit history is preserved.
 */
import { appSchema } from "./_pg-schema";
import {
  serial,
  integer,
  text,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─────────────────────────────────────────────────────────────────────────────
// ai_annotations
// ─────────────────────────────────────────────────────────────────────────────

export const aiAnnotationsTable = appSchema.table("ai_annotations", {
  id:              serial("id").primaryKey(),
  tenantId:        text("tenant_id").notNull(),

  // Anchor — what artifact/version/frame this annotation belongs to
  artifactId:      text("artifact_id").notNull(),   // creative project id, asset id, etc.
  artifactType:    text("artifact_type").notNull(),  // creative_project | cp_document | design_asset | …
  versionId:       text("version_id"),              // nullable — specific version snapshot
  frameId:         text("frame_id"),                // nullable — page / frame / view id

  // Geometry — normalized coordinates, type, optional element opaque id
  annotationType:  text("annotation_type").notNull().default("point_pin"), // point_pin | rectangle | region
  geometry:        jsonb("geometry").notNull(),      // AnnotationGeometry (normalized)
  elementId:       text("element_id"),              // opaque renderer element reference (optional)

  // Content
  title:           text("title"),
  description:     text("description"),

  // Status & priority (annotation lifecycle, NOT review decision)
  status:          text("status").notNull().default("open"),    // open | acknowledged | resolved | reopened | archived
  priority:        text("priority").notNull().default("normal"), // low | normal | high | urgent

  // Assignment
  assigneeId:      text("assignee_id"),
  assigneeName:    text("assignee_name"),

  // Actor identity — resolved server-side, never from client payload
  createdBy:       text("created_by").notNull(),
  createdByName:   text("created_by_name").notNull(),
  authorType:      text("author_type").notNull().default("admin"), // admin | client

  // Soft delete
  isDeleted:       boolean("is_deleted").notNull().default(false),
  deletedAt:       timestamp("deleted_at", { withTimezone: true }),

  metadata:        jsonb("metadata"),

  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertAiAnnotationSchema = createInsertSchema(aiAnnotationsTable).omit({
  id: true, createdAt: true, updatedAt: true, isDeleted: true, deletedAt: true,
});
export type InsertAiAnnotation = z.infer<typeof insertAiAnnotationSchema>;
export type AiAnnotation = typeof aiAnnotationsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// ai_annotation_comments
// ─────────────────────────────────────────────────────────────────────────────

export const aiAnnotationCommentsTable = appSchema.table("ai_annotation_comments", {
  id:              serial("id").primaryKey(),
  annotationId:    integer("annotation_id")
    .notNull()
    .references(() => aiAnnotationsTable.id, { onDelete: "cascade" }),
  parentCommentId: integer("parent_comment_id"), // nullable — reply to another comment

  // Body — sanitized plain text; no raw HTML stored
  body:            text("body").notNull(),

  // Actor identity — resolved server-side
  authorType:      text("author_type").notNull().default("admin"), // admin | client
  createdBy:       text("created_by").notNull(),
  createdByName:   text("created_by_name").notNull(),

  // Edit / delete state
  editedAt:        timestamp("edited_at", { withTimezone: true }),
  isDeleted:       boolean("is_deleted").notNull().default(false),
  deletedAt:       timestamp("deleted_at", { withTimezone: true }),
  deletedByType:   text("deleted_by_type"), // admin | client | system

  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertAiAnnotationCommentSchema = createInsertSchema(aiAnnotationCommentsTable).omit({
  id: true, createdAt: true, updatedAt: true, isDeleted: true, deletedAt: true, editedAt: true,
});
export type InsertAiAnnotationComment = z.infer<typeof insertAiAnnotationCommentSchema>;
export type AiAnnotationComment = typeof aiAnnotationCommentsTable.$inferSelect;
