import { appSchema } from "./_pg-schema";
import { serial, text, timestamp, jsonb, integer, bigint } from "drizzle-orm/pg-core";

/**
 * ai_zip_deliveries — Tracks background ZIP package generation per project.
 *
 * One ZIP per project (latest). Re-queuing creates a new row.
 * Status: queued → generating → completed | failed.
 * Failure is non-blocking — the project stays completed and the customer can
 * retry explicitly.
 */
export const aiZipDeliveriesTable = appSchema.table("ai_zip_deliveries", {
  id:             serial("id").primaryKey(),
  projectId:      text("project_id").notNull(),   // creative_projects.project_id
  jobId:          integer("job_id"),              // FK to ai_jobs.id

  // Status: queued | generating | completed | failed
  status:         text("status").notNull().default("queued"),

  // Output
  storagePath:    text("storage_path"),           // object storage path once generated
  downloadUrl:    text("download_url"),           // signed URL (refreshed on demand)
  fileSizeBytes:  bigint("file_size_bytes", { mode: "number" }),
  checksum:       text("checksum"),               // sha256 hex of ZIP

  // Manifest — JSON list of files included in the ZIP
  manifestJson:   jsonb("manifest_json"),

  // Error tracking
  errorMessage:   text("error_message"),
  retryCount:     integer("retry_count").notNull().default(0),

  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AiZipDelivery = typeof aiZipDeliveriesTable.$inferSelect;
export type InsertAiZipDelivery = typeof aiZipDeliveriesTable.$inferInsert;
