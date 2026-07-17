-- ═══════════════════════════════════════════════════════════════════════════
-- Enterprise Template Knowledge Library — V5.0 Migration
-- ADDITIVE ONLY: CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS
-- Safe to re-run. No DROP, TRUNCATE, or destructive operations.
-- ═══════════════════════════════════════════════════════════════════════════

SET search_path TO ai_platform, public;

-- ── Style Knowledge ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_style_knowledge (
  id                    SERIAL PRIMARY KEY,
  style_key             TEXT NOT NULL UNIQUE,
  display_name          TEXT NOT NULL,
  description           TEXT,
  color_palette         JSONB,
  typography_pairings   JSONB,
  emotions              JSONB,
  archetypes            JSONB,
  personalities         JSONB,
  industry_suitability  JSONB,
  visual_rules          JSONB,
  prompt_guidance       JSONB,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_style_knowledge_key ON ai_style_knowledge(style_key);

-- ── Industry Knowledge ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_industry_knowledge (
  id                      SERIAL PRIMARY KEY,
  industry_key            TEXT NOT NULL UNIQUE,
  industry_name           TEXT NOT NULL,
  parent_industry         TEXT,
  level                   INTEGER NOT NULL DEFAULT 1,
  business_types          JSONB,
  market_scope            JSONB,
  price_positioning       JSONB,
  target_audiences        JSONB,
  preferred_styles        JSONB,
  preferred_personalities JSONB,
  keywords                JSONB,
  notes                   TEXT,
  sort_order              INTEGER NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_industry_knowledge_key    ON ai_industry_knowledge(industry_key);
CREATE INDEX IF NOT EXISTS idx_ai_industry_knowledge_parent ON ai_industry_knowledge(parent_industry);

-- ── Section Library ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_template_sections (
  id                   SERIAL PRIMARY KEY,
  section_key          TEXT NOT NULL UNIQUE,
  section_type         TEXT NOT NULL,
  display_name         TEXT NOT NULL,
  description          TEXT,
  suitable_categories  JSONB,
  suitable_styles      JSONB,
  layout_spec          JSONB,
  content_slots        JSONB,
  prompt_guidance      JSONB,
  sort_order           INTEGER NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_template_sections_type ON ai_template_sections(section_type);
CREATE INDEX IF NOT EXISTS idx_ai_template_sections_key  ON ai_template_sections(section_key);

-- ── Template Knowledge (extended metadata) ───────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_template_knowledge (
  id                   SERIAL PRIMARY KEY,
  template_code        TEXT NOT NULL UNIQUE,
  slug                 TEXT NOT NULL UNIQUE,
  business_context     JSONB,
  brand_dna            JSONB,
  visual_dna           JSONB,
  composition          JSONB,
  output_support       JSONB,
  prompt_guidance      JSONB,
  quality_rules        JSONB,
  learning_stats       JSONB DEFAULT '{"rating":0,"usageCount":0,"successRate":0,"conversionRate":0,"revisionRate":0,"favoriteCount":0,"lastUsedAt":null}'::jsonb,
  approval_status      TEXT NOT NULL DEFAULT 'published',
  approval_notes       TEXT,
  approved_by          TEXT,
  approved_at          TIMESTAMPTZ,
  generated_by_ai      BOOLEAN NOT NULL DEFAULT FALSE,
  match_score_cache    JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_template_knowledge_code   ON ai_template_knowledge(template_code);
CREATE INDEX IF NOT EXISTS idx_ai_template_knowledge_slug   ON ai_template_knowledge(slug);
CREATE INDEX IF NOT EXISTS idx_ai_template_knowledge_status ON ai_template_knowledge(approval_status);

-- Full-text search index on brand_dna keywords + prompt guidance
CREATE INDEX IF NOT EXISTS idx_ai_template_knowledge_gin
  ON ai_template_knowledge USING gin ((brand_dna || visual_dna || prompt_guidance));

-- ── Generated Template Queue ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_generated_templates (
  id                       SERIAL PRIMARY KEY,
  requested_for_client_id  TEXT,
  trigger_match_score      REAL,
  trigger_input            JSONB,
  gap_explanation          TEXT,
  generated_template_code  TEXT NOT NULL UNIQUE,
  generated_knowledge      JSONB NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'pending_review',
  reviewed_by              TEXT,
  reviewed_at              TIMESTAMPTZ,
  review_notes             TEXT,
  published_template_code  TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_generated_templates_status ON ai_generated_templates(status);
CREATE INDEX IF NOT EXISTS idx_ai_generated_templates_code   ON ai_generated_templates(generated_template_code);
