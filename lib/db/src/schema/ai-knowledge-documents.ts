import { pgTable, serial, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { aiKnowledgeBasesTable } from "./ai-knowledge-bases";

export const aiKnowledgeDocumentsTable = pgTable("ai_knowledge_documents", {
  id: serial("id").primaryKey(),
  knowledgeBaseId: integer("knowledge_base_id").notNull().references(() => aiKnowledgeBasesTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  content: text("content"),
  contentType: text("content_type").notNull().default("text"),
  sourceUrl: text("source_url"),
  status: text("status").notNull().default("pending"),
  chunkCount: integer("chunk_count"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiKnowledgeDocumentSchema = createInsertSchema(aiKnowledgeDocumentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiKnowledgeDocument = z.infer<typeof insertAiKnowledgeDocumentSchema>;
export type AiKnowledgeDocument = typeof aiKnowledgeDocumentsTable.$inferSelect;
