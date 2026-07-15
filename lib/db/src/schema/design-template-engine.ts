import {
  bigserial,
  bigint,
  integer,
  text,
  timestamp,
  jsonb,
  unique,
} from "drizzle-orm/pg-core";
import { appSchema } from "./_pg-schema.js";

/**
 * Design Template Engine — Phase 1 Foundation
 *
 * Four tables:
 *   design_templates         — master record + status
 *   design_template_versions — immutable versioned JSON blobs
 *   design_render_batches    — aggregator for a render job set
 *   design_render_items      — one output per data row
 *
 * Naming follows existing repo conventions (bigserial PK, text tenantId,
 * withTimezone timestamps, JSONB for structured payloads).
 */

// ── design_templates ─────────────────────────────────────────────────────────

export const designTemplatesTable = appSchema.table("design_templates", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  tenantId: text("tenant_id").notNull().default("default"),
  name: text("name").notNull(),
  /** URL-safe identifier, unique per tenant */
  slug: text("slug").notNull(),
  description: text("description"),
  /** Product Promotion | Marketplace Listing | Instagram Post | … */
  category: text("category"),
  /** draft | published | archived */
  status: text("status").notNull().default("draft"),
  /** FK to the currently active design_template_versions.id */
  activeVersionId: bigint("active_version_id", { mode: "number" }),
  thumbnailUrl: text("thumbnail_url"),
  thumbnailStoragePath: text("thumbnail_storage_path"),
  /** Internal user ID or "system" */
  createdBy: text("created_by").notNull().default("system"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type DesignTemplate = typeof designTemplatesTable.$inferSelect;
export type NewDesignTemplate = typeof designTemplatesTable.$inferInsert;

// ── design_template_versions ─────────────────────────────────────────────────

/**
 * Every save creates a new row. Published versions are immutable —
 * never UPDATE template_json on a published row.
 */
export const designTemplateVersionsTable = appSchema.table("design_template_versions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  tenantId: text("tenant_id").notNull().default("default"),
  templateId: bigint("template_id", { mode: "number" }).notNull(),
  versionNumber: integer("version_number").notNull(),
  /** Semver for the DesignTemplate schema itself, e.g. "1.0" */
  schemaVersion: text("schema_version").notNull().default("1.0"),
  /** Full DesignTemplate JSON — the immutable source of truth for rendering */
  templateJson: jsonb("template_json").notNull(),
  changelog: text("changelog"),
  createdBy: text("created_by").notNull().default("system"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** Set when admin calls POST /publish — null = still draft */
  publishedAt: timestamp("published_at", { withTimezone: true }),
});

export type DesignTemplateVersion = typeof designTemplateVersionsTable.$inferSelect;
export type NewDesignTemplateVersion = typeof designTemplateVersionsTable.$inferInsert;

// ── design_render_batches ────────────────────────────────────────────────────

export const designRenderBatchesTable = appSchema.table("design_render_batches", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  tenantId: text("tenant_id").notNull().default("default"),
  templateId: bigint("template_id", { mode: "number" }).notNull(),
  templateVersionId: bigint("template_version_id", { mode: "number" }).notNull(),
  name: text("name").notNull(),
  /** draft | queued | processing | completed | partially_failed | failed | cancelled */
  status: text("status").notNull().default("draft"),
  totalItems: integer("total_items").notNull().default(0),
  queuedItems: integer("queued_items").notNull().default(0),
  processingItems: integer("processing_items").notNull().default(0),
  completedItems: integer("completed_items").notNull().default(0),
  failedItems: integer("failed_items").notNull().default(0),
  /** png | jpg | webp | pdf */
  requestedFormat: text("requested_format").notNull().default("png"),
  requestedWidth: integer("requested_width"),
  requestedHeight: integer("requested_height"),
  requestedBy: text("requested_by").notNull().default("system"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export type DesignRenderBatch = typeof designRenderBatchesTable.$inferSelect;
export type NewDesignRenderBatch = typeof designRenderBatchesTable.$inferInsert;

// ── design_render_items ──────────────────────────────────────────────────────

export const designRenderItemsTable = appSchema.table(
  "design_render_items",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: text("tenant_id").notNull().default("default"),
    batchId: bigint("batch_id", { mode: "number" }).notNull(),
    templateId: bigint("template_id", { mode: "number" }).notNull(),
    templateVersionId: bigint("template_version_id", { mode: "number" }).notNull(),
    /** 0-based row index within the batch */
    rowIndex: integer("row_index").notNull(),
    /** { variable_key: value } data supplied for this row */
    inputData: jsonb("input_data").notNull(),
    /**
     * SHA-256 of (templateVersionId + canonical JSON of inputData).
     * Used to detect duplicate render requests (idempotency).
     */
    inputHash: text("input_hash").notNull(),
    /** queued | processing | completed | failed | cancelled */
    status: text("status").notNull().default("queued"),
    attemptCount: integer("attempt_count").notNull().default(0),
    outputStoragePath: text("output_storage_path"),
    outputUrl: text("output_url"),
    outputWidth: integer("output_width"),
    outputHeight: integer("output_height"),
    outputFormat: text("output_format"),
    outputFileSizeBytes: integer("output_file_size_bytes"),
    renderDurationMs: integer("render_duration_ms"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    /** Array of non-fatal warning strings produced during render */
    renderWarnings: jsonb("render_warnings").$type<string[]>(),
    queuedAt: timestamp("queued_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** One output per (batch, row) — prevents accidental duplicate dispatch */
    uniqBatchRow: unique("drni_batch_row_uniq").on(t.batchId, t.rowIndex),
  }),
);

export type DesignRenderItem = typeof designRenderItemsTable.$inferSelect;
export type NewDesignRenderItem = typeof designRenderItemsTable.$inferInsert;
