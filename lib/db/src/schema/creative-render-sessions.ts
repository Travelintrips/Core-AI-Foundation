import { appSchema } from "./_pg-schema";
import { serial, text, timestamp, jsonb, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * creative_render_sessions — one session per "Preview → Select → Final" cycle.
 * A project can have multiple sessions (e.g. customer requests more previews).
 *
 * Status flow:
 *   planning → preview_generating → preview_ready → waiting_customer
 *   → concept_selected → final_generating → quality_check → completed
 */
export const creativeRenderSessionsTable = appSchema.table("creative_render_sessions", {
  id: serial("id").primaryKey(),
  projectId: text("project_id").notNull(), // UUID matching creative_projects.project_id

  sessionStatus: text("session_status").notNull().default("planning"),
  // planning | preview_generating | preview_ready | waiting_customer
  // | concept_selected | final_generating | quality_check | completed

  packageTier: text("package_tier").notNull().default("standard"),
  // standard | premium | enterprise

  previewCount: integer("preview_count").notNull().default(4),
  previewCostUsd: numeric("preview_cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
  finalCostUsd: numeric("final_cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
  qcCostUsd: numeric("qc_cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
  totalCostUsd: numeric("total_cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),

  selectedConceptId: integer("selected_concept_id"), // FK to creative_ai_assets.id
  customerFeedback: text("customer_feedback"),
  requestedFinalCount: integer("requested_final_count").notNull().default(1),

  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCreativeRenderSessionSchema = createInsertSchema(creativeRenderSessionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCreativeRenderSession = z.infer<typeof insertCreativeRenderSessionSchema>;
export type CreativeRenderSession = typeof creativeRenderSessionsTable.$inferSelect;
