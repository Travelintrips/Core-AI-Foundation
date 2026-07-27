-- 20260727_room_template_library.sql
-- WP-01: Room Template Library — Phase 6 Catalog Foundation
-- Idempotent — safe to run multiple times.
-- Run this before starting the API server.
-- Do NOT apply to production automatically; apply via the controlled migration process.
--
-- Tables created (in dependency order):
--   1. room_types
--   2. room_styles
--   3. room_themes
--   4. layout_constraint_sets  (FK → room_types)
--   5. room_templates           (FK → room_types, room_styles)
--
-- Scope: WP-01 only. No WP-02+ tables (furniture, sessions, placements, etc.).

-- ── 1. room_types ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_platform.room_types (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,       -- machine identifier: 'bedroom', 'living_room', etc.
  label         TEXT NOT NULL,              -- display name
  label_id      TEXT NOT NULL DEFAULT '',   -- Indonesian display name
  icon          TEXT NOT NULL DEFAULT '',   -- emoji or icon code
  constraint_set_id UUID NULL,              -- FK → layout_constraint_sets (set after WP-07)
  metadata      JSONB NOT NULL DEFAULT '{}',
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_room_types_code ON ai_platform.room_types (code);

-- ── 2. room_styles ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_platform.room_styles (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   TEXT NOT NULL,
  name_id                TEXT NOT NULL DEFAULT '',    -- Indonesian name
  slug                   TEXT NOT NULL UNIQUE,
  palette                JSONB NOT NULL DEFAULT '{}', -- ColorPalette value object
  material_finish_prefs  TEXT[] NOT NULL DEFAULT '{}',
  furniture_era          TEXT NOT NULL DEFAULT 'contemporary',
  texture_rules          JSONB NOT NULL DEFAULT '[]',
  description            TEXT NULL,
  preview_image_url      TEXT NULL,
  status                 TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'deprecated')),
  display_order          INTEGER NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_room_styles_status ON ai_platform.room_styles (status);
CREATE INDEX IF NOT EXISTS idx_room_styles_slug   ON ai_platform.room_styles (slug);

-- ── 3. room_themes ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_platform.room_themes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT NOT NULL,
  name_id              TEXT NOT NULL DEFAULT '',  -- Indonesian name
  slug                 TEXT NOT NULL UNIQUE,
  description          TEXT NULL,
  style_ids            UUID[] NOT NULL DEFAULT '{}', -- references room_styles(id)
  decoration_set_ids   UUID[] NOT NULL DEFAULT '{}',
  lighting_preset_ids  UUID[] NOT NULL DEFAULT '{}',
  preview_image_url    TEXT NULL,
  status               TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published')),
  display_order        INTEGER NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_room_themes_status ON ai_platform.room_themes (status);
CREATE INDEX IF NOT EXISTS idx_room_themes_slug   ON ai_platform.room_themes (slug);

-- ── 4. layout_constraint_sets ─────────────────────────────────────────────────
-- Note: forward-FK on room_types.constraint_set_id is deferred — set via UPDATE
-- after both tables exist. Do not add it as a real FK here to avoid circular deps.
CREATE TABLE IF NOT EXISTS ai_platform.layout_constraint_sets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  room_type_id  UUID NOT NULL REFERENCES ai_platform.room_types(id) ON DELETE CASCADE,
  rules         JSONB NOT NULL DEFAULT '[]',  -- LayoutConstraintRule[]
  version       INTEGER NOT NULL DEFAULT 1,
  description   TEXT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_layout_constraint_sets_room_type ON ai_platform.layout_constraint_sets (room_type_id);

-- ── 5. room_templates ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_platform.room_templates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  slug              TEXT NOT NULL UNIQUE,
  description       TEXT NULL,
  room_type_id      UUID NOT NULL REFERENCES ai_platform.room_types(id),
  style_id          UUID NULL REFERENCES ai_platform.room_styles(id),
  dimensions        JSONB NOT NULL DEFAULT '{"widthCm":400,"depthCm":500,"heightCm":270}',
  fixed_elements    JSONB NOT NULL DEFAULT '[]',   -- FixedElement[]
  preview_image_url TEXT NULL,
  thumbnail_url     TEXT NULL,
  tags              TEXT[] NOT NULL DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  version           INTEGER NOT NULL DEFAULT 1,
  tenant_id         UUID NULL,                     -- NULL = platform-wide template
  created_by        TEXT NOT NULL DEFAULT 'system',
  published_at      TIMESTAMPTZ NULL,
  archived_at       TIMESTAMPTZ NULL,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_room_templates_room_type ON ai_platform.room_templates (room_type_id);
CREATE INDEX IF NOT EXISTS idx_room_templates_style     ON ai_platform.room_templates (style_id) WHERE style_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_room_templates_status    ON ai_platform.room_templates (status);
CREATE INDEX IF NOT EXISTS idx_room_templates_tenant    ON ai_platform.room_templates (tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_room_templates_slug      ON ai_platform.room_templates (slug);
