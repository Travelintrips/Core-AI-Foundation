import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

/**
 * ai_schedules — Phase 6 AI Scheduler & Automation Engine
 * Defines a recurring or one-time trigger that creates jobs / publishes events.
 */
export const aiSchedulesTable = pgTable("ai_schedules", {
  id: serial("id").primaryKey(),

  scheduleCode: text("schedule_code").notNull().unique(),
  scheduleName: text("schedule_name").notNull(),
  description:  text("description"),

  triggerType: text("trigger_type").notNull(),
  // cron | interval | one_time | event_followup | deadline_reminder

  cronExpression: text("cron_expression"),
  intervalSeconds: integer("interval_seconds"),
  runAt: timestamp("run_at", { withTimezone: true }),
  timezone: text("timezone").notNull().default("UTC"),

  eventType: text("event_type"),

  targetType: text("target_type").notNull(),
  // create_job | publish_event | webhook | audit_log
  targetConfigJson: jsonb("target_config_json").notNull().default({}),
  payloadJson: jsonb("payload_json").notNull().default({}),

  status: text("status").notNull().default("active"),
  // active | paused | completed | failed | cancelled

  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  runCount: integer("run_count").notNull().default(0),
  maxRuns: integer("max_runs"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AiSchedule = typeof aiSchedulesTable.$inferSelect;
export type InsertAiSchedule = typeof aiSchedulesTable.$inferInsert;
