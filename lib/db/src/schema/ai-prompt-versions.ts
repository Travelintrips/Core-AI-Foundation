import { appSchema } from "./_pg-schema";
import { serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { aiPromptsTable } from "./ai-prompts";

export const aiPromptVersionsTable = appSchema.table("ai_prompt_versions", {
  id: serial("id").primaryKey(),
  promptId: integer("prompt_id").notNull().references(() => aiPromptsTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  content: text("content").notNull(),
  changeNote: text("change_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAiPromptVersionSchema = createInsertSchema(aiPromptVersionsTable).omit({ id: true, createdAt: true });
export type InsertAiPromptVersion = z.infer<typeof insertAiPromptVersionSchema>;
export type AiPromptVersion = typeof aiPromptVersionsTable.$inferSelect;
