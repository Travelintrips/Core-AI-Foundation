/**
 * ai-entity-versions.ts — Team 09: Generic Design Version History
 *
 * Provides an immutable, tenant-scoped version log for any versionable
 * entity in the design platform (brief snapshots, artifact metadata,
 * design specifications, export manifests).
 *
 * Immutability contract:
 *   - Rows are append-only. Content must never be updated in place.
 *   - is_approved = true makes a version immutable at the service layer.
 *   - deleted_at is the only mutable column (tombstone / soft-archive).
 *   - is_current is updated atomically when a version is promoted.
 */
import {
  bigserial,
  bigint,
  integer,
  text,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { appSchema } from "./_pg-schema.js";
import { z } from "zod/v4";

// ── Entity types supported by the versioning framework ────────────────────────
export const VERSIONABLE_ENTITY_TYPES = [
  "brief_snapshot",
  "artifact_metadata",
  "design_spec",
  "export_manifest",
] as const;
export type VersionableEntityType = (typeof VERSIONABLE_ENTITY_TYPES)[number];

// ── Actor types that can create a version ─────────────────────────────────────
export const VERSION_ACTOR_TYPES = ["human", "ai_agent", "system", "import"] as const;
export type VersionActorType = (typeof VERSION_ACTOR_TYPES)[number];

// ── Revision reasons ──────────────────────────────────────────────────────────
export const REVISION_REASONS = [
  "initial",
  "ai_generation",
  "human_edit",
  "client_revision",
  "admin_correction",
  "restore",
  "import",
] as const;
export type RevisionReason = (typeof REVISION_REASONS)[number];

// ── Table definition ──────────────────────────────────────────────────────────
export const aiEntityVersionsTable = appSchema.table(
  "ai_entity_versions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    // ── Entity identity ────────────────────────────────────────────────────
    /** e.g. 'brief_snapshot' | 'artifact_metadata' | 'design_spec' | 'export_manifest' */
    entityType: text("entity_type").notNull(),
    /** UUID or string PK of the owning entity (e.g. project_id, asset_id) */
    entityId: text("entity_id").notNull(),
    /** Tenant that owns this entity — mandatory for all tenant-owned versions */
    tenantId: text("tenant_id").notNull(),

    // ── Version numbering ──────────────────────────────────────────────────
    /** Monotonic integer per (entity_type, entity_id, tenant_id). 1-based. */
    versionNumber: integer("version_number").notNull(),
    /** Human-readable label — e.g. "v1", "v2 (Client Revision)" */
    versionLabel: text("version_label"),

    // ── Idempotency ────────────────────────────────────────────────────────
    /**
     * Caller-supplied idempotency key. A second createVersion call with the
     * same key returns the existing version without error or duplication.
     * Unique per (entity_type, entity_id, tenant_id) when present.
     */
    idempotencyKey: text("idempotency_key"),

    // ── Content ────────────────────────────────────────────────────────────
    /** SHA-256 hex of JSON.stringify(contentSnapshot). Used for dedup detection. */
    contentHash: text("content_hash").notNull(),
    /** Full serialized content snapshot — never store binary blobs here */
    contentSnapshot: jsonb("content_snapshot").notNull(),

    // ── Lineage ────────────────────────────────────────────────────────────
    /** id of the version this was derived from (null for initial versions) */
    parentVersionId: bigint("parent_version_id", { mode: "number" }),

    // ── Change provenance ──────────────────────────────────────────────────
    /** Why this version exists — free text description */
    reason: text("reason"),
    /** Structured revision category */
    revisionReason: text("revision_reason"),
    /** Actor who created this version: user id, agent id, or "system" */
    actorId: text("actor_id"),
    /** Actor class — never store tokens or credentials here */
    actorType: text("actor_type").notNull().default("system"),

    // ── AI provenance (no secrets stored) ─────────────────────────────────
    /** AI job ID that produced this content — traceability without secrets */
    aiJobId: text("ai_job_id"),
    /** AI model name/slug — e.g. "gpt-4o", not any keys */
    aiModel: text("ai_model"),

    // ── Approval / current pointer ─────────────────────────────────────────
    /**
     * Once true: version is immutable. Any attempt to update content fields
     * must be rejected at the service layer.
     */
    isApproved: boolean("is_approved").notNull().default(false),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: text("approved_by"),

    /**
     * True for the single version currently designated as "active".
     * Updated atomically in a transaction when promoting a version.
     */
    isCurrent: boolean("is_current").notNull().default(false),

    // ── Client review link ─────────────────────────────────────────────────
    /** FK to creative_ai_client_reviews.id — additive relation */
    reviewId: integer("review_id"),

    // ── Soft-delete / tombstone (WP-04 pattern) ────────────────────────────
    /** NULL = active, set = archived/tombstoned. Never hard-deleted. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Monotonic uniqueness — prevents duplicate version numbers per entity
    uniqueIndex("ai_entity_versions_entity_version_uidx").on(
      t.entityType,
      t.entityId,
      t.tenantId,
      t.versionNumber,
    ),
    // Idempotency key — partial unique (only when key is present, enforced in DDL)
    index("ai_entity_versions_idempotency_idx").on(
      t.entityType,
      t.entityId,
      t.tenantId,
      t.idempotencyKey,
    ),
    // Fast lookup for listing/diff by entity
    index("ai_entity_versions_entity_idx").on(t.entityType, t.entityId, t.tenantId),
    // Tenant-scoped queries
    index("ai_entity_versions_tenant_idx").on(t.tenantId),
    // Current version pointer lookup
    index("ai_entity_versions_current_idx").on(t.entityType, t.entityId, t.tenantId, t.isCurrent),
  ],
);

export const insertAiEntityVersionSchema = createInsertSchema(aiEntityVersionsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertAiEntityVersion = z.infer<typeof insertAiEntityVersionSchema>;
export type AiEntityVersion = typeof aiEntityVersionsTable.$inferSelect;
