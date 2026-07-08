import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  timestamp,
} from "drizzle-orm/pg-core";

export const aiWorkersTable = pgTable("ai_workers", {
  id: serial("id").primaryKey(),

  workerName: text("worker_name").notNull().unique(),
  status: text("status").notNull().default("idle"),
  // online | offline | maintenance | busy | idle

  currentJob: integer("current_job"),
  // soft FK → ai_jobs.id; null when idle

  lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true })
    .notNull()
    .defaultNow(),

  // Daily metrics (reset at midnight UTC)
  runningJobs:    integer("running_jobs").notNull().default(0),
  completedToday: integer("completed_today").notNull().default(0),
  failedToday:    integer("failed_today").notNull().default(0),
  averageLatency: numeric("average_latency", { precision: 12, scale: 2 }),
  // rolling average latency in ms

  version: text("version").notNull().default("1.0.0"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AiWorker = typeof aiWorkersTable.$inferSelect;
export type InsertAiWorker = typeof aiWorkersTable.$inferInsert;
