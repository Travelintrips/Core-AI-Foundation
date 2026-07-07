import { pgTable, serial, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Human Feedback — approve/reject/revise loop on Creative AI step outputs.
 * Stores original AI output alongside any human edits. Never overwrites the original.
 */
export const aiFeedbackTable = pgTable("ai_feedback", {
  id: serial("id").primaryKey(),
  projectId: text("project_id").notNull(),  // Creative project UUID (string)
  stepId: integer("step_id"),               // creative_project_steps.id
  stepName: text("step_name"),              // "Brand Strategy", "Copy Production", etc.
  // Human decision
  action: text("action").notNull(),         // approve | reject | needs_revision | human_edit
  rating: integer("rating"),               // 1–5 stars (null if not rated)
  feedbackText: text("feedback_text"),      // Free-form comment
  // Output tracking — original is never overwritten
  originalOutput: jsonb("original_output"), // AI output as-is at time of review
  editedOutput: jsonb("edited_output"),     // Human-edited version (null if no edit)
  diff: text("diff"),                       // Text diff between original and edited (optional)
  reviewer: text("reviewer").notNull().default("human"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAiFeedbackSchema = createInsertSchema(aiFeedbackTable).omit({ id: true, createdAt: true });
export type InsertAiFeedback = z.infer<typeof insertAiFeedbackSchema>;
export type AiFeedback = typeof aiFeedbackTable.$inferSelect;
