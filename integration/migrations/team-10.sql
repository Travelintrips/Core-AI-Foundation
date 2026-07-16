-- ============================================================
-- Team 10 — Typography Pairing & Color Palette Engine
-- Branch: feature/10-typography-palette
-- Status: DRAFT — not yet run. Team 24 integrates.
-- All statements are additive (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- No DROP, no TRUNCATE, no rename destructive, no changes to other domains.
-- ============================================================

-- 1. Font Pair Registry
CREATE TABLE IF NOT EXISTS ai_platform.dt_font_pairs (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL,
  slug                TEXT NOT NULL UNIQUE,
  display_font        TEXT NOT NULL,
  body_font           TEXT NOT NULL,
  accent_font         TEXT,
  category            TEXT NOT NULL DEFAULT 'sans-serif',
  mood                JSONB NOT NULL DEFAULT '[]',
  industries          JSONB NOT NULL DEFAULT '[]',
  display_font_weight TEXT NOT NULL DEFAULT '700',
  body_font_weight    TEXT NOT NULL DEFAULT '400',
  license             TEXT NOT NULL DEFAULT 'open',
  pairing_rationale   TEXT,
  sample_heading      TEXT NOT NULL DEFAULT 'The quick brown fox',
  sample_body         TEXT NOT NULL DEFAULT 'Typography is the art of arranging type.',
  google_fonts_url    TEXT,
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dt_font_pairs_slug     ON ai_platform.dt_font_pairs (slug);
CREATE INDEX IF NOT EXISTS idx_dt_font_pairs_category ON ai_platform.dt_font_pairs (category);
CREATE INDEX IF NOT EXISTS idx_dt_font_pairs_active   ON ai_platform.dt_font_pairs (active);
CREATE INDEX IF NOT EXISTS idx_dt_font_pairs_mood     ON ai_platform.dt_font_pairs USING GIN (mood);
CREATE INDEX IF NOT EXISTS idx_dt_font_pairs_industries ON ai_platform.dt_font_pairs USING GIN (industries);

-- 2. Typography Roles (one row per role per pair)
CREATE TABLE IF NOT EXISTS ai_platform.dt_typography_roles (
  id             SERIAL PRIMARY KEY,
  pair_id        INTEGER NOT NULL REFERENCES ai_platform.dt_font_pairs(id) ON DELETE CASCADE,
  role           TEXT NOT NULL,
  font_family    TEXT NOT NULL,
  font_size      NUMERIC(6, 2) NOT NULL,
  font_weight    TEXT NOT NULL DEFAULT '400',
  line_height    NUMERIC(5, 2) NOT NULL DEFAULT 1.5,
  letter_spacing NUMERIC(6, 3) NOT NULL DEFAULT 0,
  text_transform TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (pair_id, role)
);

CREATE INDEX IF NOT EXISTS idx_dt_typography_roles_pair_id ON ai_platform.dt_typography_roles (pair_id);

-- 3. Color Palette Registry
CREATE TABLE IF NOT EXISTS ai_platform.dt_color_palettes (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT,
  style       TEXT NOT NULL DEFAULT 'custom',
  mood        JSONB NOT NULL DEFAULT '[]',
  industries  JSONB NOT NULL DEFAULT '[]',
  colors      JSONB NOT NULL DEFAULT '[]',
  print_safe  BOOLEAN NOT NULL DEFAULT FALSE,
  accessible  BOOLEAN NOT NULL DEFAULT FALSE,
  wcag_level  TEXT NOT NULL DEFAULT 'fail',
  tags        JSONB NOT NULL DEFAULT '[]',
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dt_color_palettes_slug       ON ai_platform.dt_color_palettes (slug);
CREATE INDEX IF NOT EXISTS idx_dt_color_palettes_style      ON ai_platform.dt_color_palettes (style);
CREATE INDEX IF NOT EXISTS idx_dt_color_palettes_accessible ON ai_platform.dt_color_palettes (accessible);
CREATE INDEX IF NOT EXISTS idx_dt_color_palettes_print_safe ON ai_platform.dt_color_palettes (print_safe);
CREATE INDEX IF NOT EXISTS idx_dt_color_palettes_wcag_level ON ai_platform.dt_color_palettes (wcag_level);
CREATE INDEX IF NOT EXISTS idx_dt_color_palettes_mood       ON ai_platform.dt_color_palettes USING GIN (mood);
CREATE INDEX IF NOT EXISTS idx_dt_color_palettes_industries ON ai_platform.dt_color_palettes USING GIN (industries);
CREATE INDEX IF NOT EXISTS idx_dt_color_palettes_tags       ON ai_platform.dt_color_palettes USING GIN (tags);

-- 4. Semantic Color Roles (computed metadata per role per palette)
CREATE TABLE IF NOT EXISTS ai_platform.dt_semantic_color_roles (
  id               SERIAL PRIMARY KEY,
  palette_id       INTEGER NOT NULL REFERENCES ai_platform.dt_color_palettes(id) ON DELETE CASCADE,
  role             TEXT NOT NULL,
  hex_color        TEXT NOT NULL,
  hsl_color        TEXT NOT NULL,
  rgb_color        TEXT NOT NULL,
  cmyk_color       TEXT,
  print_safe_hex   TEXT,
  contrast_on_white NUMERIC(5, 2) NOT NULL DEFAULT 1,
  contrast_on_black NUMERIC(5, 2) NOT NULL DEFAULT 1,
  wcag_aa_on_white  BOOLEAN NOT NULL DEFAULT FALSE,
  wcag_aa_on_black  BOOLEAN NOT NULL DEFAULT FALSE,
  wcag_aaa_on_white BOOLEAN NOT NULL DEFAULT FALSE,
  wcag_aaa_on_black BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (palette_id, role)
);

CREATE INDEX IF NOT EXISTS idx_dt_semantic_roles_palette_id ON ai_platform.dt_semantic_color_roles (palette_id);
CREATE INDEX IF NOT EXISTS idx_dt_semantic_roles_role        ON ai_platform.dt_semantic_color_roles (role);
CREATE INDEX IF NOT EXISTS idx_dt_semantic_roles_wcag_aa     ON ai_platform.dt_semantic_color_roles (wcag_aa_on_white);

-- ============================================================
-- END Team 10 Migration Draft
-- ============================================================
