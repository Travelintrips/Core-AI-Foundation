-- =============================================================================
-- WP-03A Placement Engine — Base Tables (v2 rebuild)
-- Migration: wp03a-placement-engine-v2.sql
--
-- Creates:
--   ai_platform.layout_sessions
--   ai_platform.placements
--
-- Rules:
--   • Idempotent — safe to run multiple times (IF NOT EXISTS everywhere)
--   • Additive — no DROP TABLE, no ALTER COLUMN type changes
--   • No data deletion
--   • Must run BEFORE rls-wp03a-placement-engine-v2.sql
--   • Must run BEFORE wp03a-placement-tenant-consistency-v2.sql
--
-- Apply to DEV first, then PROD after validation.
-- Do NOT use drizzle-kit push.
-- =============================================================================

SET search_path TO ai_platform, public;

-- ── layout_sessions ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.layout_sessions (
  id                UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         UUID,                                         -- NULL = platform-wide
  room_template_id  UUID,                                         -- soft ref → room_templates (WP-01)
  name              TEXT        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'archived')),
  coordinate_unit   TEXT        NOT NULL DEFAULT 'cm',
  room_width_cm     NUMERIC(10,2) NOT NULL
                    CHECK (room_width_cm > 0),
  room_length_cm    NUMERIC(10,2) NOT NULL
                    CHECK (room_length_cm > 0),
  metadata          JSONB       NOT NULL DEFAULT '{}',
  created_by        TEXT        NOT NULL DEFAULT 'system',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at       TIMESTAMPTZ,

  CONSTRAINT pk_layout_sessions PRIMARY KEY (id)
);

-- ── placements ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.placements (
  id                UUID        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         UUID,                                         -- must match layout_sessions.tenant_id
  session_id        UUID        NOT NULL,
  furniture_item_id UUID        NOT NULL,                         -- soft ref → furniture_items (WP-02)

  -- Position (centimetres, 2D top-down)
  x_cm              NUMERIC(10,2) NOT NULL DEFAULT 0,
  y_cm              NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Dimensions (all must be > 0)
  width_cm          NUMERIC(10,2) NOT NULL
                    CHECK (width_cm > 0),
  depth_cm          NUMERIC(10,2) NOT NULL
                    CHECK (depth_cm > 0),
  height_cm         NUMERIC(10,2) NOT NULL
                    CHECK (height_cm > 0),

  -- Orientation: normalized to [0, 360) before storage
  rotation_deg      NUMERIC(8,4) NOT NULL DEFAULT 0
                    CHECK (rotation_deg >= 0 AND rotation_deg < 360),

  -- Anchor and snap
  anchor_type       TEXT NOT NULL DEFAULT 'none'
                    CHECK (anchor_type IN ('none', 'wall', 'corner', 'item')),
  anchor_data       JSONB NOT NULL DEFAULT '{}',
  snap_type         TEXT NOT NULL DEFAULT 'none'
                    CHECK (snap_type IN ('none', 'grid', 'wall', 'corner', 'item_anchor')),
  snap_data         JSONB NOT NULL DEFAULT '{}',

  -- Metadata and versioning
  metadata          JSONB    NOT NULL DEFAULT '{}',
  version           INTEGER  NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by        TEXT     NOT NULL DEFAULT 'system',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at       TIMESTAMPTZ,

  CONSTRAINT pk_placements                     PRIMARY KEY (id),
  CONSTRAINT fk_placements_session             FOREIGN KEY (session_id)
    REFERENCES ai_platform.layout_sessions(id) ON DELETE CASCADE
);

-- ── Indexes — layout_sessions ─────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_layout_sessions_tenant
  ON ai_platform.layout_sessions (tenant_id);

CREATE INDEX IF NOT EXISTS idx_layout_sessions_status
  ON ai_platform.layout_sessions (status);

CREATE INDEX IF NOT EXISTS idx_layout_sessions_archived
  ON ai_platform.layout_sessions (archived_at)
  WHERE archived_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_layout_sessions_template
  ON ai_platform.layout_sessions (room_template_id)
  WHERE room_template_id IS NOT NULL;

-- ── Indexes — placements ──────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_placements_session
  ON ai_platform.placements (session_id);

CREATE INDEX IF NOT EXISTS idx_placements_tenant
  ON ai_platform.placements (tenant_id);

CREATE INDEX IF NOT EXISTS idx_placements_furniture_item
  ON ai_platform.placements (furniture_item_id);

CREATE INDEX IF NOT EXISTS idx_placements_archived
  ON ai_platform.placements (archived_at)
  WHERE archived_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_placements_session_active
  ON ai_platform.placements (session_id)
  WHERE archived_at IS NULL;

-- =============================================================================
-- Verification (run after applying):
--
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'ai_platform'
--   AND table_name IN ('layout_sessions', 'placements');
--
-- Expected: 2 rows
-- =============================================================================
