import { appSchema } from "./_pg-schema";
import {
  serial,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { aiHumanTasksTable } from "./ai-human-tasks";

export const aiHumanTaskHistoryTable = appSchema.table("ai_human_task_history", {
  id:          serial("id").primaryKey(),
  taskId:      integer("task_id").notNull().references(() => aiHumanTasksTable.id, { onDelete: "cascade" }),

  // What happened
  action:      text("action").notNull(),
  // created | assigned | accepted | rejected | in_progress | completed | reassigned | expired | escalated | cancelled

  performedBy: text("performed_by"),
  notes:       text("notes"),
  oldStatus:   text("old_status"),
  newStatus:   text("new_status"),

  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AiHumanTaskHistory       = typeof aiHumanTaskHistoryTable.$inferSelect;
export type InsertAiHumanTaskHistory = typeof aiHumanTaskHistoryTable.$inferInsert;
