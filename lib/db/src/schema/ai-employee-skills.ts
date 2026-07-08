import { pgTable, serial, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { aiEmployeesTable } from "./ai-employees";
import { aiSkillsTable } from "./ai-skills";

export const aiEmployeeSkillsTable = pgTable("ai_employee_skills", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => aiEmployeesTable.id, { onDelete: "cascade" }),
  skillId: integer("skill_id").notNull().references(() => aiSkillsTable.id, { onDelete: "cascade" }),

  // Proficiency 1–5 (1=Beginner, 5=Expert)
  proficiency: integer("proficiency").notNull().default(3),

  // Scores 0–100
  experienceScore: numeric("experience_score", { precision: 5, scale: 2 }).default("70"),
  accuracyScore:   numeric("accuracy_score",   { precision: 5, scale: 2 }).default("70"),
  speedScore:      numeric("speed_score",       { precision: 5, scale: 2 }).default("70"),
  costScore:       numeric("cost_score",        { precision: 5, scale: 2 }).default("70"),

  lastTrainedAt: timestamp("last_trained_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiEmployeeSkillSchema = createInsertSchema(aiEmployeeSkillsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiEmployeeSkill = z.infer<typeof insertAiEmployeeSkillSchema>;
export type AiEmployeeSkill = typeof aiEmployeeSkillsTable.$inferSelect;
