import { appSchema } from "./_pg-schema";
import { serial, text, timestamp, jsonb, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { creativeProjectsTable } from "./creative-projects";
import { aiAgentsTable } from "./ai-agents";

export const creativeAiAssetsTable = appSchema.table("creative_ai_assets", {
  id: serial("id").primaryKey(),
  projectId: text("project_id").notNull(), // UUID string — matches creativeProjectsTable.projectId
  stepId: integer("step_id"), // optional FK to creative_project_steps.id
  agentId: integer("agent_id").references(() => aiAgentsTable.id, { onDelete: "set null" }),
  provider: text("provider").notNull(), // e.g. "replicate"
  model: text("model").notNull(), // e.g. "black-forest-labs/flux-schnell"
  assetType: text("asset_type").notNull().default("image"),
  prompt: text("prompt").notNull(),
  negativePrompt: text("negative_prompt"),
  aspectRatio: text("aspect_ratio"), // e.g. "1:1", "16:9"
  imageUrl: text("image_url"),
  storagePath: text("storage_path"),
  thumbnailUrl: text("thumbnail_url"),
  status: text("status").notNull().default("pending"),
  // pending | generating | completed | failed | approved | needs_revision | rejected
  qcScore: integer("qc_score"), // 1–100
  qcNotes: text("qc_notes"),
  cost: numeric("cost", { precision: 10, scale: 6 }), // USD
  latencyMs: integer("latency_ms"),
  metadata: jsonb("metadata"),
  // Customer Workspace additions (additive, all nullable/defaulted — no impact
  // on existing inserts). Powers Brand Asset Library grouping + version history.
  category: text("category"), // logo | logo_variant | brand_guideline | typography | color_palette | icon | illustration | packaging | presentation | social_media | company_profile | source_file | other
  version: integer("version").notNull().default(1),
  parentAssetId: integer("parent_asset_id"), // self-reference: previous version of this asset
  approvedBy: text("approved_by"),
  revisionNotes: text("revision_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCreativeAiAssetSchema = createInsertSchema(creativeAiAssetsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCreativeAiAsset = z.infer<typeof insertCreativeAiAssetSchema>;
export type CreativeAiAsset = typeof creativeAiAssetsTable.$inferSelect;
