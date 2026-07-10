import { appSchema } from "./_pg-schema";
import { serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { creativeAiClientReviewsTable } from "./creative-ai-client-reviews";

export const creativeAiClientCommentsTable = appSchema.table("creative_ai_client_comments", {
  id: serial("id").primaryKey(),
  reviewId: integer("review_id")
    .notNull()
    .references(() => creativeAiClientReviewsTable.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull(), // UUID
  assetId: integer("asset_id"),            // nullable — comment on a specific asset
  stepId: integer("step_id"),              // nullable — comment on a specific step
  parentCommentId: integer("parent_comment_id"), // nullable — threaded replies
  authorName: text("author_name").notNull(),
  authorType: text("author_type").notNull().default("client"), // client | admin
  comment: text("comment").notNull(),
  status: text("status").notNull().default("open"), // open | resolved | archived
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertCreativeAiClientCommentSchema = createInsertSchema(creativeAiClientCommentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCreativeAiClientComment = z.infer<typeof insertCreativeAiClientCommentSchema>;
export type CreativeAiClientComment = typeof creativeAiClientCommentsTable.$inferSelect;
