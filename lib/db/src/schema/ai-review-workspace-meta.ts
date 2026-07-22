import { appSchema } from "./_pg-schema";
import { serial, integer, text, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * ai_review_workspace_meta
 * One optional row per creative_ai_client_review — stores workspace-level
 * metadata that is not part of the canonical review token flow:
 *  - due date
 *  - internal sign-off
 *  - per-checklist-item completion state (config-driven, stored as JSONB)
 *  - cancel reason (when a review is revoked from the workspace)
 *
 * Table is created idempotently by the review-workspace route on startup.
 * Drizzle schema is kept here so ORM type inference works throughout the app.
 */
export const aiReviewWorkspaceMetaTable = appSchema.table("ai_review_workspace_meta", {
  id: serial("id").primaryKey(),
  reviewId: integer("review_id").notNull().unique(), // FK → creative_ai_client_reviews.id
  dueDate: timestamp("due_date", { withTimezone: true }),
  internalSignedOff: boolean("internal_signed_off").notNull().default(false),
  internalSignedOffBy: text("internal_signed_off_by"),
  internalSignedOffAt: timestamp("internal_signed_off_at", { withTimezone: true }),
  /** Map of checklistItemId → { completedAt: ISO string, completedBy: string } */
  checklistState: jsonb("checklist_state")
    .notNull()
    .default({})
    .$type<Record<string, { completedAt: string; completedBy: string }>>(),
  cancelReason: text("cancel_reason"),
  cancelledBy: text("cancelled_by"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertAiReviewWorkspaceMetaSchema = createInsertSchema(aiReviewWorkspaceMetaTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiReviewWorkspaceMeta = z.infer<typeof insertAiReviewWorkspaceMetaSchema>;
export type AiReviewWorkspaceMeta = typeof aiReviewWorkspaceMetaTable.$inferSelect;
