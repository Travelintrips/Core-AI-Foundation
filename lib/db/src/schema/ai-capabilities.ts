import { pgTable, serial, text, timestamp, integer, boolean, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { aiProvidersTable } from "./ai-providers";
import { aiModelsTable } from "./ai-models";

/**
 * Capability Matrix — per-skill performance scores for each provider/model/agent combination.
 * Used by the Intelligent Router to score and select the best model for a given task.
 */
export const aiCapabilitiesTable = pgTable("ai_capabilities", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").references(() => aiProvidersTable.id, { onDelete: "set null" }),
  modelId: integer("model_id").references(() => aiModelsTable.id, { onDelete: "set null" }),
  agentSlug: text("agent_slug"),        // Which agent this capability applies to (null = any)
  skill: text("skill").notNull(),        // e.g., "brand-strategy", "copywriting", "quality-control"
  accuracyScore: numeric("accuracy_score", { precision: 5, scale: 2 }),  // 0–100
  speedScore: numeric("speed_score", { precision: 5, scale: 2 }),        // 0–100
  costScore: numeric("cost_score", { precision: 5, scale: 2 }),          // 0–100 (higher = cheaper)
  maxContext: integer("max_context"),
  supportsImage: boolean("supports_image").notNull().default(false),
  supportsJson: boolean("supports_json").notNull().default(true),
  supportsTool: boolean("supports_tool").notNull().default(false),
  supportsStream: boolean("supports_stream").notNull().default(false),
  priority: integer("priority").notNull().default(50),
  status: text("status").notNull().default("active"),  // active | inactive
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiCapabilitySchema = createInsertSchema(aiCapabilitiesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiCapability = z.infer<typeof insertAiCapabilitySchema>;
export type AiCapability = typeof aiCapabilitiesTable.$inferSelect;
