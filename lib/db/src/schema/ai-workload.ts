import { pgTable, serial, integer, numeric, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { aiEmployeesTable } from "./ai-employees";

export const aiWorkloadTable = pgTable("ai_workload", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().unique().references(() => aiEmployeesTable.id, { onDelete: "cascade" }),

  runningJobs:     integer("running_jobs").notNull().default(0),
  queuedJobs:      integer("queued_jobs").notNull().default(0),
  completedToday:  integer("completed_today").notNull().default(0),
  failedToday:     integer("failed_today").notNull().default(0),

  averageLatency: numeric("average_latency", { precision: 10, scale: 2 }),  // ms
  averageCost:    numeric("average_cost",    { precision: 10, scale: 6 }),  // USD per job

  availability: integer("availability").notNull().default(100),  // 0–100 %

  // Idle | Busy | Offline | Maintenance
  status: text("status").notNull().default("idle"),

  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiWorkloadSchema = createInsertSchema(aiWorkloadTable).omit({ id: true, updatedAt: true });
export type InsertAiWorkload = z.infer<typeof insertAiWorkloadSchema>;
export type AiWorkload = typeof aiWorkloadTable.$inferSelect;
