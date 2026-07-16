import {
  bigserial,
  bigint,
  integer,
  text,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { appSchema } from "./_pg-schema.js";

/**
 * design_render_zip_exports — tracks ZIP export jobs for design render batches.
 *
 * Status lifecycle: queued → generating → completed | failed
 * Idempotency: source_fingerprint (sha256 of sorted completed-item output set)
 *   means identical batch output produces only one ZIP.
 */
export const designRenderZipExportsTable = appSchema.table("design_render_zip_exports", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  tenantId: text("tenant_id").notNull().default("default"),
  batchId: bigint("batch_id", { mode: "number" }).notNull(),
  /** queued | generating | completed | failed */
  status: text("status").notNull().default("queued"),
  /**
   * sha256 of sorted {item_id, output_storage_path, checksum} for all
   * completed render items. Same output set → same fingerprint (idempotent).
   */
  sourceFingerprint: text("source_fingerprint").notNull(),
  /** Object storage path once ZIP is generated */
  zipStoragePath: text("zip_storage_path"),
  fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
  /**
   * JSON manifest embedded in ZIP and also stored here for quick retrieval.
   * Shape: { batchId, tenantId, exportedAt, sourceFingerprint, items[] }
   */
  manifestJson: jsonb("manifest_json"),
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DesignRenderZipExport = typeof designRenderZipExportsTable.$inferSelect;
export type NewDesignRenderZipExport = typeof designRenderZipExportsTable.$inferInsert;
