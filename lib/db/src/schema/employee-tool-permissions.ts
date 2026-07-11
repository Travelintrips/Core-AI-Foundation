import { appSchema } from "./_pg-schema";
import { serial, integer, boolean, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { aiEmployeesTable } from "./ai-employees";
import { aiToolsTable } from "./ai-tools";

export const employeeToolPermissionsTable = appSchema.table("employee_tool_permissions", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => aiEmployeesTable.id, { onDelete: "cascade" }),
  toolId: integer("tool_id").notNull().references(() => aiToolsTable.id, { onDelete: "cascade" }),

  canRead:    boolean("can_read").notNull().default(true),
  canWrite:   boolean("can_write").notNull().default(false),
  canExecute: boolean("can_execute").notNull().default(true),

  grantedBy: text("granted_by"),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEmployeeToolPermissionSchema = createInsertSchema(employeeToolPermissionsTable).omit({ id: true, grantedAt: true });
export type InsertEmployeeToolPermission = z.infer<typeof insertEmployeeToolPermissionSchema>;
export type EmployeeToolPermission = typeof employeeToolPermissionsTable.$inferSelect;
