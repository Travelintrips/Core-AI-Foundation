import { appSchema } from "./_pg-schema";
import { serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const aiSkillsTable = appSchema.table("ai_skills", {
  id: serial("id").primaryKey(),
  skillCode: text("skill_code").notNull().unique(),
  skillName: text("skill_name").notNull(),
  category: text("category"),          // e.g., "creative", "finance", "legal"
  description: text("description"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiSkillSchema = createInsertSchema(aiSkillsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiSkill = z.infer<typeof insertAiSkillSchema>;
export type AiSkill = typeof aiSkillsTable.$inferSelect;
