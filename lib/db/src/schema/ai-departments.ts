import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const aiDepartmentsTable = pgTable("ai_departments", {
  id: serial("id").primaryKey(),
  departmentCode: text("department_code").notNull().unique(),
  departmentName: text("department_name").notNull(),
  description: text("description"),
  managerAgentId: integer("manager_agent_id"), // nullable — FK added after ai_employees exists
  status: text("status").notNull().default("active"), // active | inactive
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiDepartmentSchema = createInsertSchema(aiDepartmentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiDepartment = z.infer<typeof insertAiDepartmentSchema>;
export type AiDepartment = typeof aiDepartmentsTable.$inferSelect;
