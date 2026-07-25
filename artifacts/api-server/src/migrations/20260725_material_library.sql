-- 20260725_material_library.sql
-- Phase 1: Interior Design Material Intelligence Library
-- Idempotent — safe to run multiple times.

CREATE TABLE IF NOT EXISTS ai_platform.material_categories (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  icon          TEXT NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_platform.materials (
  id               SERIAL PRIMARY KEY,
  material_code    TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  slug             TEXT NOT NULL UNIQUE,
  category         TEXT NOT NULL,
  subcategory      TEXT,
  brand            TEXT,
  material_type    TEXT,
  color            TEXT,
  finish           TEXT,
  texture          TEXT,
  pattern          TEXT,
  description      TEXT,
  price_tier       TEXT NOT NULL DEFAULT 'Standard',
  thumbnail_url    TEXT,
  preview_images   JSONB,
  technical_data   JSONB,
  search_keywords  JSONB,
  status           TEXT NOT NULL DEFAULT 'active',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_materials_category      ON ai_platform.materials (category);
CREATE INDEX IF NOT EXISTS idx_materials_brand         ON ai_platform.materials (brand);
CREATE INDEX IF NOT EXISTS idx_materials_price_tier    ON ai_platform.materials (price_tier);
CREATE INDEX IF NOT EXISTS idx_materials_status        ON ai_platform.materials (status);
CREATE INDEX IF NOT EXISTS idx_materials_finish        ON ai_platform.materials (finish);
CREATE INDEX IF NOT EXISTS idx_materials_color         ON ai_platform.materials (color);
CREATE INDEX IF NOT EXISTS idx_materials_name_lower    ON ai_platform.materials (LOWER(name));
CREATE INDEX IF NOT EXISTS idx_material_categories_ord ON ai_platform.material_categories (display_order);
