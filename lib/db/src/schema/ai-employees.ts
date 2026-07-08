import { pgTable, serial, text, integer, boolean, numeric, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { aiDepartmentsTable } from "./ai-departments";
import { aiProvidersTable } from "./ai-providers";
import { aiModelsTable } from "./ai-models";

export const aiEmployeesTable = pgTable("ai_employees", {
  id: serial("id").primaryKey(),

  // Identity
  employeeCode: text("employee_code").notNull().unique(),
  employeeName: text("employee_name").notNull(),
  avatarUrl: text("avatar_url"),
  bio: text("bio"),

  // Organisation
  departmentId: integer("department_id").references(() => aiDepartmentsTable.id, { onDelete: "set null" }),
  position: text("position").notNull(),       // e.g., "Brand Strategist"
  role: text("role").notNull(),               // e.g., "specialist" | "manager" | "director"
  level: text("level").notNull().default("junior"), // junior | mid | senior | lead | director
  supervisorId: integer("supervisor_id"),     // self-referential; FK applied after table exists

  // AI backend
  providerId: integer("provider_id").references(() => aiProvidersTable.id, { onDelete: "set null" }),
  modelId: integer("model_id").references(() => aiModelsTable.id, { onDelete: "set null" }),
  systemPromptId: integer("system_prompt_id"),       // FK to ai_prompts
  memoryProfileId: integer("memory_profile_id"),     // FK to ai_memory
  knowledgeProfileId: integer("knowledge_profile_id"), // FK to ai_knowledge_bases

  // Agent slug link (backward compat with existing Creative AI agents)
  agentSlug: text("agent_slug"),

  // Cost & capacity
  costCenter: text("cost_center"),
  salaryVirtual: numeric("salary_virtual", { precision: 12, scale: 2 }).default("0"),
  hourlyCost: numeric("hourly_cost", { precision: 8, scale: 4 }).default("0"),
  maxParallelJobs: integer("max_parallel_jobs").notNull().default(3),

  // Routing priority
  priority: integer("priority").notNull().default(50),

  // Status
  status: text("status").notNull().default("active"), // active | busy | offline | maintenance

  // Extra metadata (photo, tags, etc.)
  metadata: jsonb("metadata"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiEmployeeSchema = createInsertSchema(aiEmployeesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiEmployee = z.infer<typeof insertAiEmployeeSchema>;
export type AiEmployee = typeof aiEmployeesTable.$inferSelect;
