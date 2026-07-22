-- ── Team 09: Design Version History & Revision System ──────────────────────
-- Migration: ai_entity_versions generic versioning table
-- Safe to run multiple times (all statements are IF NOT EXISTS / idempotent).
-- Rollback: DROP TABLE ai_platform.ai_entity_versions CASCADE (data loss — only
-- do this before the table has been written to in production).

SET search_path TO ai_platform, public;

-- ── Primary table ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_platform.ai_entity_versions (
  id                BIGSERIAL PRIMARY KEY,

  -- Entity identity
  entity_type       TEXT        NOT NULL,  -- brief_snapshot | artifact_metadata | design_spec | export_manifest
  entity_id         TEXT        NOT NULL,  -- UUID or string key of the owning entity
  tenant_id         TEXT        NOT NULL,  -- Mandatory tenant scope

  -- Version numbering (monotonic per entity, 1-based)
  version_number    INTEGER     NOT NULL,
  version_label     TEXT,                  -- e.g. "v1", "v2 (Client Revision)"

  -- Idempotency (unique per entity when non-null, enforced by partial index below)
  idempotency_key   TEXT,

  -- Content (no binary blobs — reference storage by URL/path only)
  content_hash      TEXT        NOT NULL,  -- SHA-256 hex of JSON.stringify(content_snapshot)
  content_snapshot  JSONB       NOT NULL,  -- Full versioned content

  -- Lineage
  parent_version_id BIGINT      REFERENCES ai_platform.ai_entity_versions(id) ON DELETE SET NULL,

  -- Change provenance (no secrets stored here)
  reason            TEXT,
  revision_reason   TEXT,        -- initial | ai_generation | human_edit | client_revision | admin_correction | restore | import
  actor_id          TEXT,
  actor_type        TEXT        NOT NULL DEFAULT 'system',  -- human | ai_agent | system | import

  -- AI provenance (model name / job ID only — never keys or prompts)
  ai_job_id         TEXT,
  ai_model          TEXT,

  -- Approval / immutability
  is_approved       BOOLEAN     NOT NULL DEFAULT FALSE,
  approved_at       TIMESTAMPTZ,
  approved_by       TEXT,

  -- Current version pointer (updated atomically on promote)
  is_current        BOOLEAN     NOT NULL DEFAULT FALSE,

  -- Client review link (additive, nullable)
  review_id         INTEGER,    -- FK to creative_ai_client_reviews.id (soft ref — no hard FK to avoid cross-schema coupling)

  -- Soft-delete / tombstone (WP-04 pattern)
  deleted_at        TIMESTAMPTZ,           -- NULL = active, set = archived

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Monotonic uniqueness ──────────────────────────────────────────────────────
-- Prevents two concurrent transactions from assigning the same version_number.
CREATE UNIQUE INDEX IF NOT EXISTS ai_entity_versions_entity_version_uidx
  ON ai_platform.ai_entity_versions (entity_type, entity_id, tenant_id, version_number);

-- ── Idempotency key (partial — only when key is present) ─────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS ai_entity_versions_idempotency_uidx
  ON ai_platform.ai_entity_versions (entity_type, entity_id, tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ── Performance indexes ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS ai_entity_versions_entity_idx
  ON ai_platform.ai_entity_versions (entity_type, entity_id, tenant_id);

CREATE INDEX IF NOT EXISTS ai_entity_versions_tenant_idx
  ON ai_platform.ai_entity_versions (tenant_id);

CREATE INDEX IF NOT EXISTS ai_entity_versions_current_idx
  ON ai_platform.ai_entity_versions (entity_type, entity_id, tenant_id, is_current)
  WHERE is_current = TRUE;

CREATE INDEX IF NOT EXISTS ai_entity_versions_approved_idx
  ON ai_platform.ai_entity_versions (entity_type, entity_id, tenant_id, is_approved)
  WHERE is_approved = TRUE;

-- ── Constraint: entity_type values ───────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ai_entity_versions_entity_type_chk'
      AND table_schema = 'ai_platform'
  ) THEN
    ALTER TABLE ai_platform.ai_entity_versions
      ADD CONSTRAINT ai_entity_versions_entity_type_chk
      CHECK (entity_type IN ('brief_snapshot', 'artifact_metadata', 'design_spec', 'export_manifest'));
  END IF;
END;
$$;
