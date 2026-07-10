import { appSchema } from "./_pg-schema";
import { serial, text, boolean, timestamp, jsonb, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { aiProvidersTable } from "./ai-providers";

export const aiModelsTable = appSchema.table("ai_models", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => aiProvidersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  modelId: text("model_id").notNull(),
  capabilities: text("capabilities").array().notNull().default([]),
  contextWindow: integer("context_window"),
  maxOutputTokens: integer("max_output_tokens"),
  costPerInputToken: numeric("cost_per_input_token", { precision: 12, scale: 8 }),
  costPerOutputToken: numeric("cost_per_output_token", { precision: 12, scale: 8 }),
  isActive: boolean("is_active").notNull().default(true),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiModelSchema = createInsertSchema(aiModelsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiModel = z.infer<typeof insertAiModelSchema>;
export type AiModel = typeof aiModelsTable.$inferSelect;
