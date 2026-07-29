-- ============================================================
-- WP-03A: Placement Engine — forward migration (v2)
-- Schema: ai_platform
-- Idempotent: all objects use IF NOT EXISTS / CREATE TABLE IF NOT EXISTS
-- Do NOT apply to production without a dry-run review.
-- ============================================================

SET search_path TO ai_platform, public;

-- ── layout_sessions ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.layout_sessions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL,
  room_template_id UUID,
  name             TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'draft'   CHECK (status IN ('draft', 'active', 'archived')),

  width_cm         NUMERIC(10,2) NOT NULL DEFAULT 400  CHECK (width_cm  > 0),
  depth_cm         NUMERIC(10,2) NOT NULL DEFAULT 500  CHECK (depth_cm  > 0),
  height_cm        NUMERIC(10,2) NOT NULL DEFAULT 270  CHECK (height_cm > 0),

  created_by       TEXT        NOT NULL DEFAULT 'system',
  archived_at      TIMESTAMPTZ,
  deleted_at       TIMESTAMPTZ,
  metadata         JSONB       NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  ai_platform.layout_sessions IS 'WP-03A — Tenant-owned design canvas sessions with room geometry.';
COMMENT ON COLUMN ai_platform.layout_sessions.tenant_id IS 'Required — layout sessions are always tenant-scoped.';
COMMENT ON COLUMN ai_platform.layout_sessions.status    IS 'draft → active → archived lifecycle.';
COMMENT ON COLUMN ai_platform.layout_sessions.deleted_at IS 'Soft-delete marker — never hard-delete rows.';

CREATE INDEX IF NOT EXISTS idx_layout_sessions_tenant_id  ON ai_platform.layout_sessions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_layout_sessions_status     ON ai_platform.layout_sessions (status);
CREATE INDEX IF NOT EXISTS idx_layout_sessions_deleted_at ON ai_platform.layout_sessions (deleted_at) WHERE deleted_at IS NULL;

-- ── placements ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.placements (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID          NOT NULL REFERENCES ai_platform.layout_sessions(id) ON DELETE CASCADE,
  tenant_id         UUID          NOT NULL,
  furniture_item_id UUID,

  label             TEXT          NOT NULL DEFAULT '',

  x_cm              NUMERIC(10,2) NOT NULL DEFAULT 0,
  y_cm              NUMERIC(10,2) NOT NULL DEFAULT 0,

  width_cm          NUMERIC(10,2) NOT NULL DEFAULT 0   CHECK (width_cm  > 0),
  depth_cm          NUMERIC(10,2) NOT NULL DEFAULT 0   CHECK (depth_cm  > 0),

  rotation_deg      NUMERIC(8,4)  NOT NULL DEFAULT 0   CHECK (rotation_deg >= 0 AND rotation_deg < 360),

  anchor_x          NUMERIC(5,4)  NOT NULL DEFAULT 0   CHECK (anchor_x >= 0 AND anchor_x <= 1),
  anchor_y          NUMERIC(5,4)  NOT NULL DEFAULT 0   CHECK (anchor_y >= 0 AND anchor_y <= 1),

  clearance_front_cm NUMERIC(8,2) NOT NULL DEFAULT 0   CHECK (clearance_front_cm >= 0),
  clearance_side_cm  NUMERIC(8,2) NOT NULL DEFAULT 0   CHECK (clearance_side_cm  >= 0),
  clearance_back_cm  NUMERIC(8,2) NOT NULL DEFAULT 0   CHECK (clearance_back_cm  >= 0),

  is_archived       BOOLEAN       NOT NULL DEFAULT false,

  version           INTEGER       NOT NULL DEFAULT 1,
  metadata          JSONB         NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

COMMENT ON TABLE  ai_platform.placements IS 'WP-03A — Furniture placements on a layout session canvas.';
COMMENT ON COLUMN ai_platform.placements.tenant_id     IS 'Denormalised from session for RLS — must match session.tenant_id.';
COMMENT ON COLUMN ai_platform.placements.rotation_deg  IS 'Pre-normalised to [0,360) before write.';
COMMENT ON COLUMN ai_platform.placements.is_archived   IS 'Archived placements are excluded from collision checks (WP-03B).';

CREATE INDEX IF NOT EXISTS idx_placements_session_id    ON ai_platform.placements (session_id);
CREATE INDEX IF NOT EXISTS idx_placements_tenant_id     ON ai_platform.placements (tenant_id);
CREATE INDEX IF NOT EXISTS idx_placements_is_archived   ON ai_platform.placements (is_archived) WHERE is_archived = false;

-- ── Tenant consistency check function ────────────────────────────────────────
-- Ensures placements.tenant_id always mirrors layout_sessions.tenant_id.
-- Applied via wp03a-placement-tenant-consistency-v2.sql.

-- ============================================================
-- Rollback notes:
--   DROP TABLE IF EXISTS ai_platform.placements;
--   DROP TABLE IF EXISTS ai_platform.layout_sessions;
-- ============================================================
