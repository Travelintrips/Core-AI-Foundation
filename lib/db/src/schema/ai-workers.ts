import { appSchema } from "./_pg-schema";
import {
  serial,
  text,
  integer,
  numeric,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

export const aiWorkersTable = appSchema.table("ai_workers", {
  id: serial("id").primaryKey(),

  // ── Identity ────────────────────────────────────────────────────────────
  workerName: text("worker_name").notNull().unique(),
  workerType: text("worker_type").notNull().default("system_worker"),
  // text_worker | image_worker | export_worker | system_worker

  // ── Cluster / Node ──────────────────────────────────────────────────────
  clusterId:  text("cluster_id").notNull().default("default"),
  nodeId:     text("node_id").notNull().default("local"),
  region:     text("region").notNull().default("local"),
  version:    text("version").notNull().default("1.0.0"),

  // Capabilities this worker can process (string[])
  capabilities:      jsonb("capabilities").notNull().default([]),
  maxConcurrentJobs: integer("max_concurrent_jobs").notNull().default(2),

  // ── Lease ───────────────────────────────────────────────────────────────
  leaseOwner:     text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  heartbeatToken: text("heartbeat_token"),
  lockVersion:    integer("lock_version").notNull().default(0),

  // ── Runtime status ──────────────────────────────────────────────────────
  status:     text("status").notNull().default("idle"),
  // online | offline | maintenance | busy | idle | stale

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

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AiWorker = typeof aiWorkersTable.$inferSelect;
export type InsertAiWorker = typeof aiWorkersTable.$inferInsert;
