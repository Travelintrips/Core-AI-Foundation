-- =============================================================================
-- TEAM 09 — Pattern, Motif, Texture & Decorative Asset Library
-- Branch: feature/09-pattern-library
-- Status: DRAFT — do NOT run without Team 24 review
-- All statements are additive (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
-- No DROP, no TRUNCATE, no destructive renames
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. design_patterns — master registry of all patterns, motifs, textures
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_platform.design_patterns (
  id                SERIAL PRIMARY KEY,
  slug              TEXT NOT NULL UNIQUE,               -- machine-readable key e.g. "batik-kawung-v1"
  name              TEXT NOT NULL,                      -- human display name
  category          TEXT NOT NULL                       -- "pattern" | "motif" | "texture" | "decoration"
                    CHECK (category IN ('pattern','motif','texture','decoration')),
  domain            TEXT NOT NULL                       -- geometric | corporate | luxury | marble | abstract
                    CHECK (domain IN (
                      'geometric','corporate','luxury','marble','abstract',
                      'wave','floral','leaf','batik-inspired','textile',
                      'interior','wood','stone','metal','fabric','packaging'
                    )),
  style             TEXT NOT NULL DEFAULT 'modern',     -- modern | traditional | minimalist | ornate | organic
  description       TEXT,

  -- Repeat / tiling
  repeat_behavior   TEXT NOT NULL DEFAULT 'tile'        -- tile | half-drop | mirror | brick | no-repeat
                    CHECK (repeat_behavior IN ('tile','half-drop','mirror','brick','no-repeat')),
  scale             TEXT NOT NULL DEFAULT 'md'          -- xs | sm | md | lg | xl | full-bleed
                    CHECK (scale IN ('xs','sm','md','lg','xl','full-bleed')),

  -- Color
  colorizable       BOOLEAN NOT NULL DEFAULT TRUE,
  color_palette     JSONB NOT NULL DEFAULT '[]',        -- array of hex strings (default palette)

  -- Preview assets
  preview_url       TEXT,                               -- full-res preview image URL
  preview_thumb_url TEXT,                               -- thumbnail URL

  -- Licensing & provenance (REQUIRED — no copyrighted marks without clearance)
  source_type       TEXT NOT NULL DEFAULT 'original'    -- original | licensed | public-domain | creative-commons
                    CHECK (source_type IN ('original','licensed','public-domain','creative-commons')),
  license           TEXT,                               -- SPDX id or URL e.g. "CC-BY-4.0"
  source_attribution TEXT,                             -- full attribution string

  -- Cultural metadata (required for batik-inspired / culturally significant assets)
  cultural_origin   TEXT,                               -- e.g. "Central Java, Indonesia"
  cultural_notes    TEXT,                               -- disclaimers, context, do-not-claim note

  -- Compatibility
  compatibility     JSONB NOT NULL DEFAULT '[]',        -- e.g. ["print","web","embroidery","packaging"]

  -- Discovery
  tags              TEXT[] NOT NULL DEFAULT '{}',
  version           TEXT NOT NULL DEFAULT '1.0.0',
  status            TEXT NOT NULL DEFAULT 'active'      -- active | draft | archived
                    CHECK (status IN ('active','draft','archived')),

  -- Audit
  created_by        TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 2. design_pattern_variants — color / scale variants of a master pattern
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_platform.design_pattern_variants (
  id                SERIAL PRIMARY KEY,
  pattern_id        INTEGER NOT NULL REFERENCES ai_platform.design_patterns(id) ON DELETE CASCADE,
  slug              TEXT NOT NULL UNIQUE,               -- e.g. "batik-kawung-v1-navy"
  name              TEXT NOT NULL,                      -- "Navy Blue Variant"
  color_palette     JSONB NOT NULL DEFAULT '[]',
  scale             TEXT NOT NULL DEFAULT 'md'
                    CHECK (scale IN ('xs','sm','md','lg','xl','full-bleed')),
  preview_url       TEXT,
  preview_thumb_url TEXT,
  status            TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','draft','archived')),
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 3. design_pattern_compatibility_matrix — explicit compat records
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_platform.design_pattern_compat (
  id                SERIAL PRIMARY KEY,
  pattern_id        INTEGER NOT NULL REFERENCES ai_platform.design_patterns(id) ON DELETE CASCADE,
  context           TEXT NOT NULL,                      -- "web" | "print" | "embroidery" | "packaging" | ...
  min_dpi           INTEGER,                            -- minimum DPI for this context
  max_scale         TEXT,                               -- maximum recommended scale in this context
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Indexes (all IF NOT EXISTS)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_design_patterns_domain
  ON ai_platform.design_patterns (domain);

CREATE INDEX IF NOT EXISTS idx_design_patterns_category
  ON ai_platform.design_patterns (category);

CREATE INDEX IF NOT EXISTS idx_design_patterns_status
  ON ai_platform.design_patterns (status);

CREATE INDEX IF NOT EXISTS idx_design_patterns_tags
  ON ai_platform.design_patterns USING GIN (tags);

CREATE INDEX IF NOT EXISTS idx_design_patterns_slug
  ON ai_platform.design_patterns (slug);

CREATE INDEX IF NOT EXISTS idx_design_pattern_variants_pattern_id
  ON ai_platform.design_pattern_variants (pattern_id);

CREATE INDEX IF NOT EXISTS idx_design_pattern_compat_pattern_id
  ON ai_platform.design_pattern_compat (pattern_id);

-- Full-text search index on name + description + tags
CREATE INDEX IF NOT EXISTS idx_design_patterns_fts
  ON ai_platform.design_patterns
  USING GIN (
    to_tsvector('english',
      COALESCE(name, '') || ' ' ||
      COALESCE(description, '') || ' ' ||
      COALESCE(array_to_string(tags, ' '), '')
    )
  );
