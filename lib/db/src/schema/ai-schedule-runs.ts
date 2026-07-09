import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { aiSchedulesTable } from "./ai-schedules";

/**
 * ai_schedule_runs — Phase 6 AI Scheduler & Automation Engine
 * Execution history for a schedule.
 */
export const aiScheduleRunsTable = pgTable("ai_schedule_runs", {
  id: serial("id").primaryKey(),

  scheduleId: integer("schedule_id")
    .notNull()
    .references(() => aiSchedulesTable.id, { onDelete: "cascade" }),

  runNumber: integer("run_number").notNull(),

  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  startedAt:    timestamp("started_at",    { withTimezone: true }),
  completedAt:  timestamp("completed_at",  { withTimezone: true }),

  status: text("status").notNull().default("pending"),
  // pending | running | completed | failed | skipped

  resultJson:   jsonb("result_json"),
  errorMessage: text("error_message"),

  createdJobId:   integer("created_job_id"),
  createdEventId: text("created_event_id"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AiScheduleRun = typeof aiScheduleRunsTable.$inferSelect;
export type InsertAiScheduleRun = typeof aiScheduleRunsTable.$inferInsert;
