import { appSchema } from "./_pg-schema";
import { serial, text, timestamp, jsonb, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const aiMemoryTable = appSchema.table("ai_memory", {
  id: serial("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  sessionId: text("session_id"),
  memoryType: text("memory_type").notNull().default("short_term"),
  content: text("content").notNull(),
  key: text("key"),
  importance: numeric("importance", { precision: 4, scale: 3 }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAiMemorySchema = createInsertSchema(aiMemoryTable).omit({ id: true, createdAt: true });
export type InsertAiMemory = z.infer<typeof insertAiMemorySchema>;
export type AiMemory = typeof aiMemoryTable.$inferSelect;
