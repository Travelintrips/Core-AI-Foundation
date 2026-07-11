import { appSchema } from "./_pg-schema";
import { serial, text, boolean, timestamp, jsonb, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { aiProvidersTable } from "./ai-providers";
import { aiModelsTable } from "./ai-models";
import { aiKnowledgeBasesTable } from "./ai-knowledge-bases";

export const aiAgentsTable = appSchema.table("ai_agents", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  role: text("role").notNull(),
  description: text("description"),
  providerId: integer("provider_id").references(() => aiProvidersTable.id, { onDelete: "set null" }),
  modelId: integer("model_id").references(() => aiModelsTable.id, { onDelete: "set null" }),
  priority: integer("priority").notNull().default(100),
  temperature: numeric("temperature", { precision: 4, scale: 2 }),
  maxTokens: integer("max_tokens"),
  status: text("status").notNull().default("active"), // active | inactive | draft
  allowedTools: text("allowed_tools").array().notNull().default([]),
  knowledgeBaseId: integer("knowledge_base_id").references(() => aiKnowledgeBasesTable.id, { onDelete: "set null" }),
  version: text("version").notNull().default("1.0.0"),
  owner: text("owner"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiAgentSchema = createInsertSchema(aiAgentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiAgent = z.infer<typeof insertAiAgentSchema>;
export type AiAgent = typeof aiAgentsTable.$inferSelect;
