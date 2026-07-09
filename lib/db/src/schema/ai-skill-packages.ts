import { pgTable, serial, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * ai_skill_packages — Phase 8 AI Skills Marketplace
 *
 * A skill package is an installable capability bundle (e.g. "Brand Strategy",
 * "OCR Invoice"). Distinct from the lightweight `ai_skills` table used by
 * workforce employee-skill assignment — this is the marketplace catalog.
 */
export const aiSkillPackagesTable = pgTable("ai_skill_packages", {
  id: serial("id").primaryKey(),

  skillCode: text("skill_code").notNull().unique(),
  skillName: text("skill_name").notNull(),
  category: text("category"), // creative | finance | legal | tax | logistics | operations
  description: text("description"),

  version: text("version").notNull().default("1.0.0"),
  author: text("author").default("AI Enterprise Platform"),
  icon: text("icon"),

  status: text("status").notNull().default("published"),
  // draft | published | deprecated

  requiredCapabilities: jsonb("required_capabilities").notNull().default([]),
  requiredTools: jsonb("required_tools").notNull().default([]),
  configurationSchema: jsonb("configuration_schema").notNull().default({}),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiSkillPackageSchema = createInsertSchema(aiSkillPackagesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiSkillPackage = z.infer<typeof insertAiSkillPackageSchema>;
export type AiSkillPackage = typeof aiSkillPackagesTable.$inferSelect;
