import { appSchema } from "./_pg-schema";
import { serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const creativeAiClientReviewsTable = appSchema.table("creative_ai_client_reviews", {
  id: serial("id").primaryKey(),
  projectId: text("project_id").notNull(), // UUID — matches creative_projects.project_id
  clientName: text("client_name").notNull(),
  clientEmail: text("client_email"),
  clientPhone: text("client_phone"),
  reviewTokenHash: text("review_token_hash").notNull().unique(), // SHA-256 hex of plaintext token
  reviewTokenPlain: text("review_token_plain"), // Stored only for customer-submitted projects so dashboard can surface the link
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("not_shared"),
  // not_shared | shared | viewed | approved | rejected | revision_requested | expired | revoked
  sharedAt: timestamp("shared_at", { withTimezone: true }),
  viewedAt: timestamp("viewed_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  revisionRequestedAt: timestamp("revision_requested_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertCreativeAiClientReviewSchema = createInsertSchema(creativeAiClientReviewsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCreativeAiClientReview = z.infer<typeof insertCreativeAiClientReviewSchema>;
export type CreativeAiClientReview = typeof creativeAiClientReviewsTable.$inferSelect;
