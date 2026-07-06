import { pgTable, serial, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const aiKnowledgeBasesTable = pgTable("ai_knowledge_bases", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  embeddingModel: text("embedding_model").notNull().default("text-embedding-3-small"),
  isActive: boolean("is_active").notNull().default(true),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiKnowledgeBaseSchema = createInsertSchema(aiKnowledgeBasesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiKnowledgeBase = z.infer<typeof insertAiKnowledgeBaseSchema>;
export type AiKnowledgeBase = typeof aiKnowledgeBasesTable.$inferSelect;
