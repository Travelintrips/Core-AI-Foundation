-- Team 17 — Interior Design Asset Images
-- Additive migration — NO DROP, NO TRUNCATE, NO DESTRUCTIVE RENAME
-- Idempotent: IF NOT EXISTS throughout
-- Run against Supabase with: SET search_path TO ai_platform, public;

SET search_path TO ai_platform, public;

-- ── Interior Design Asset Images ──────────────────────────────────────────────
-- Stores image metadata for items within Interior Design concept drafts.
-- Items live inside JSONB columns (materialsDraft, furnitureDraft, etc.)
-- so we key by (project_uuid, item_type, item_id).
--
-- is_manual_upload = TRUE means admin uploaded manually — NEVER overwrite.

CREATE TABLE IF NOT EXISTS ai_platform.id_interior_asset_images (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Item reference (composite natural key)
  project_uuid      TEXT    NOT NULL,
  item_type         TEXT    NOT NULL
                      CHECK (item_type IN ('material', 'furniture', 'lighting', 'space_plan')),
  item_id           TEXT    NOT NULL,  -- matches the 'id' field in the JSONB item array

  -- Image storage
  thumbnail_url     TEXT,   -- permanent Supabase CDN URL (600×600 WebP or resized)
  image_url         TEXT,   -- full-size Supabase CDN URL (may be same as thumbnail_url)

  -- Accessibility & attribution
  image_alt         TEXT,
  image_source      TEXT,   -- 'pexels' | 'unsplash' | 'pixabay' | 'manual' | 'internal'
  image_source_url  TEXT,   -- original source page URL (for attribution)
  image_license     TEXT,   -- e.g. 'Pexels License', 'Unsplash License', 'CC0'
  image_attribution TEXT,   -- photographer / author name

  -- Upload metadata
  is_manual_upload  BOOLEAN NOT NULL DEFAULT FALSE,
  storage_path      TEXT,   -- relative path inside interior-assets bucket
  mime_type         TEXT    NOT NULL DEFAULT 'image/webp',
  file_size_bytes   INTEGER,

  image_updated_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One image record per (project, type, item) — upsert safe
  UNIQUE (project_uuid, item_type, item_id)
);

CREATE INDEX IF NOT EXISTS idx_id_interior_asset_images_project_uuid
  ON ai_platform.id_interior_asset_images (project_uuid);

CREATE INDEX IF NOT EXISTS idx_id_interior_asset_images_item_type
  ON ai_platform.id_interior_asset_images (project_uuid, item_type);

CREATE INDEX IF NOT EXISTS idx_id_interior_asset_images_no_thumb
  ON ai_platform.id_interior_asset_images (project_uuid)
  WHERE thumbnail_url IS NULL;
