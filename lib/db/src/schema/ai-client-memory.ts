import { appSchema } from "./_pg-schema";
import { serial, text, timestamp, numeric, jsonb, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Client Long-Term Memory — persistent key-value brand preferences per client.
 * Examples: preferred_color, writing_style, target_audience, approved_cta, visual_style.
 * Separate from ai_memory (which is agent/session scoped).
 */
export const aiClientMemoryTable = appSchema.table(
  "ai_client_memory",
  {
    id: serial("id").primaryKey(),
    clientId: text("client_id").notNull(),   // Brand name or external client UUID
    key: text("key").notNull(),               // e.g., "preferred_color", "writing_style"
    value: text("value").notNull(),
    valueType: text("value_type").notNull().default("string"), // string | json | array | number
    category: text("category"),               // brand | visual | copy | audience | business
    source: text("source").notNull().default("manual"), // manual | inferred | approved_project
    confidence: numeric("confidence", { precision: 4, scale: 3 }), // 0.000–1.000
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [unique("ai_client_memory_client_key").on(t.clientId, t.key)],
);

export const insertAiClientMemorySchema = createInsertSchema(aiClientMemoryTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiClientMemory = z.infer<typeof insertAiClientMemorySchema>;
export type AiClientMemory = typeof aiClientMemoryTable.$inferSelect;
