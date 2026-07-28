-- ─────────────────────────────────────────────────────────────────────────────
-- WP-02 — Furniture & Object Library
-- Phase 6 — Baseline: material-v6.0.1-wp01
--
-- Creates 7 tables in the ai_platform schema:
--   furniture_categories, furniture_brands, furniture_collections,
--   furniture_items, furniture_assets, furniture_tags, furniture_item_tags
--
-- Design rules:
--   • All PKs are UUIDs with gen_random_uuid() default
--   • Soft delete on furniture_items via deleted_at (nullable timestamp)
--   • Version increment tracked on furniture_items
--   • Tenant isolation: null tenant_id = platform-wide
--   • Audit fields: created_at / updated_at on every table
--   • Hand-written DDL — drizzle-kit push is DISABLED for production safety
--
-- DO NOT apply with drizzle-kit push.
-- Apply to DEV first. After validation apply to PROD.
-- ─────────────────────────────────────────────────────────────────────────────

SET search_path TO ai_platform, public;

-- ── 1. furniture_categories ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.furniture_categories (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code           TEXT        NOT NULL UNIQUE,
  name           TEXT        NOT NULL,
  name_id        TEXT        NOT NULL DEFAULT '',
  slug           TEXT        NOT NULL UNIQUE,
  parent_id      UUID        REFERENCES ai_platform.furniture_categories(id) ON DELETE SET NULL,
  icon           TEXT        NOT NULL DEFAULT '',
  description    TEXT,
  is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
  display_order  INTEGER     NOT NULL DEFAULT 0,
  metadata       JSONB       NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_furniture_categories_parent_id
  ON ai_platform.furniture_categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_furniture_categories_is_active
  ON ai_platform.furniture_categories(is_active);
CREATE INDEX IF NOT EXISTS idx_furniture_categories_display_order
  ON ai_platform.furniture_categories(display_order);

-- ── 2. furniture_brands ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.furniture_brands (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code              TEXT        NOT NULL UNIQUE,
  name              TEXT        NOT NULL,
  slug              TEXT        NOT NULL UNIQUE,
  country_of_origin TEXT,
  website_url       TEXT,
  logo_url          TEXT,
  description       TEXT,
  status            TEXT        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'inactive')),
  display_order     INTEGER     NOT NULL DEFAULT 0,
  metadata          JSONB       NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_furniture_brands_status
  ON ai_platform.furniture_brands(status);
CREATE INDEX IF NOT EXISTS idx_furniture_brands_display_order
  ON ai_platform.furniture_brands(display_order);

-- ── 3. furniture_collections ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.furniture_collections (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT        NOT NULL UNIQUE,
  name          TEXT        NOT NULL,
  slug          TEXT        NOT NULL UNIQUE,
  brand_id      UUID        REFERENCES ai_platform.furniture_brands(id) ON DELETE SET NULL,
  description   TEXT,
  style         TEXT,
  launch_year   INTEGER,
  status        TEXT        NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'inactive', 'archived')),
  display_order INTEGER     NOT NULL DEFAULT 0,
  metadata      JSONB       NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_furniture_collections_brand_id
  ON ai_platform.furniture_collections(brand_id);
CREATE INDEX IF NOT EXISTS idx_furniture_collections_status
  ON ai_platform.furniture_collections(status);

-- ── 4. furniture_items ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.furniture_items (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code               TEXT        NOT NULL UNIQUE,
  name               TEXT        NOT NULL,
  name_id            TEXT        NOT NULL DEFAULT '',
  slug               TEXT        NOT NULL UNIQUE,
  description        TEXT,
  category_id        UUID        NOT NULL REFERENCES ai_platform.furniture_categories(id),
  brand_id           UUID        REFERENCES ai_platform.furniture_brands(id) ON DELETE SET NULL,
  collection_id      UUID        REFERENCES ai_platform.furniture_collections(id) ON DELETE SET NULL,

  -- Classification
  style              TEXT,
  furniture_type     TEXT,
  primary_materials  TEXT[]      NOT NULL DEFAULT '{}',
  finishes           TEXT[]      NOT NULL DEFAULT '{}',
  colors             TEXT[]      NOT NULL DEFAULT '{}',

  -- Dimensions (cm / kg)
  dimensions         JSONB       NOT NULL DEFAULT '{"widthCm":0,"depthCm":0,"heightCm":0}',

  -- Commercial
  price_tier         TEXT        NOT NULL DEFAULT 'mid'
                                 CHECK (price_tier IN ('budget', 'mid', 'premium', 'luxury')),
  sku                TEXT,

  -- Media
  thumbnail_url      TEXT,
  preview_images     TEXT[]      NOT NULL DEFAULT '{}',

  -- Search
  search_keywords    TEXT[]      NOT NULL DEFAULT '{}',

  -- Lifecycle
  status             TEXT        NOT NULL DEFAULT 'draft'
                                 CHECK (status IN ('draft', 'published', 'archived')),
  version            INTEGER     NOT NULL DEFAULT 1,
  tenant_id          UUID,
  created_by         TEXT        NOT NULL DEFAULT 'system',
  published_at       TIMESTAMPTZ,
  archived_at        TIMESTAMPTZ,
  deleted_at         TIMESTAMPTZ,               -- soft delete; NULL = not deleted

  metadata           JSONB       NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Core lookup indexes
CREATE INDEX IF NOT EXISTS idx_furniture_items_category_id
  ON ai_platform.furniture_items(category_id);
CREATE INDEX IF NOT EXISTS idx_furniture_items_brand_id
  ON ai_platform.furniture_items(brand_id);
CREATE INDEX IF NOT EXISTS idx_furniture_items_collection_id
  ON ai_platform.furniture_items(collection_id);
CREATE INDEX IF NOT EXISTS idx_furniture_items_status
  ON ai_platform.furniture_items(status);
CREATE INDEX IF NOT EXISTS idx_furniture_items_deleted_at
  ON ai_platform.furniture_items(deleted_at);
CREATE INDEX IF NOT EXISTS idx_furniture_items_tenant_id
  ON ai_platform.furniture_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_furniture_items_price_tier
  ON ai_platform.furniture_items(price_tier);
CREATE INDEX IF NOT EXISTS idx_furniture_items_style
  ON ai_platform.furniture_items(style);
CREATE INDEX IF NOT EXISTS idx_furniture_items_furniture_type
  ON ai_platform.furniture_items(furniture_type);
-- Partial index: the hot path is published + not deleted
CREATE INDEX IF NOT EXISTS idx_furniture_items_published_active
  ON ai_platform.furniture_items(status, deleted_at)
  WHERE status = 'published' AND deleted_at IS NULL;
-- GIN index for array-column filtering
CREATE INDEX IF NOT EXISTS idx_furniture_items_primary_materials_gin
  ON ai_platform.furniture_items USING GIN (primary_materials);
CREATE INDEX IF NOT EXISTS idx_furniture_items_colors_gin
  ON ai_platform.furniture_items USING GIN (colors);
CREATE INDEX IF NOT EXISTS idx_furniture_items_search_keywords_gin
  ON ai_platform.furniture_items USING GIN (search_keywords);

-- ── 5. furniture_assets ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.furniture_assets (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  furniture_item_id UUID        NOT NULL REFERENCES ai_platform.furniture_items(id) ON DELETE CASCADE,
  asset_type        TEXT        NOT NULL DEFAULT 'preview'
                                CHECK (asset_type IN ('thumbnail', 'preview', 'render', 'spec_sheet', 'model')),
  url               TEXT        NOT NULL,
  file_name         TEXT,
  mime_type         TEXT,
  file_size_bytes   INTEGER,
  sort_order        INTEGER     NOT NULL DEFAULT 0,
  is_public         BOOLEAN     NOT NULL DEFAULT TRUE,
  metadata          JSONB       NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_furniture_assets_item_id
  ON ai_platform.furniture_assets(furniture_item_id);
CREATE INDEX IF NOT EXISTS idx_furniture_assets_asset_type
  ON ai_platform.furniture_assets(asset_type);

-- ── 6. furniture_tags ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.furniture_tags (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL UNIQUE,
  slug          TEXT        NOT NULL UNIQUE,
  description   TEXT,
  display_order INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_furniture_tags_display_order
  ON ai_platform.furniture_tags(display_order);

-- ── 7. furniture_item_tags ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.furniture_item_tags (
  furniture_item_id UUID        NOT NULL REFERENCES ai_platform.furniture_items(id)  ON DELETE CASCADE,
  tag_id            UUID        NOT NULL REFERENCES ai_platform.furniture_tags(id)   ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_furniture_item_tags PRIMARY KEY (furniture_item_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_furniture_item_tags_tag_id
  ON ai_platform.furniture_item_tags(tag_id);

-- ── Verification queries ──────────────────────────────────────────────────────
-- Run after applying to confirm tables are created:
--
--   SET search_path TO ai_platform;
--   SELECT table_name
--     FROM information_schema.tables
--    WHERE table_schema = 'ai_platform'
--      AND table_name LIKE 'furniture_%'
--    ORDER BY table_name;
--   -- Expected: 7 rows
--
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname = 'ai_platform' AND indexname LIKE 'idx_furniture_%'
--    ORDER BY indexname;
--   -- Expected: 18+ indexes
