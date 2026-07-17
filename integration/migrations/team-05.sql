-- Team 05 — Brand Intelligence 2.0
-- Migration draft — DO NOT EXECUTE directly.
-- Team 24 (Integration Lead) will apply this after review.
--
-- Rules obeyed:
--   - Additive only (no DROP, no TRUNCATE, no destructive rename)
--   - Does not touch any other team's tables
--   - Uses CREATE INDEX IF NOT EXISTS
--   - Uses CREATE TABLE IF NOT EXISTS
--   - All within ai_platform schema

-- ── Table: ai_brand_intelligence_v2 ─────────────────────────────────────────
-- Extends ai_brand_dna via client_id (no hard FK — keeps domains decoupled).
-- One row per clientId (upserted on re-analysis).

CREATE TABLE IF NOT EXISTS ai_platform.ai_brand_intelligence_v2 (
  id                        SERIAL PRIMARY KEY,
  client_id                 TEXT NOT NULL,

  -- Extended visual language (grid, motion, contrast, border, shadow)
  visual_language           JSONB,

  -- Detailed tone & writing style
  tone_writing_style        JSONB,

  -- Per-color psychology with confidence + color mask
  color_psychology_detailed JSONB,

  -- Detailed typography profile (scale, weights, line-height, a11y score)
  typography_profile        JSONB,

  -- Photography style (shot types, lighting, grading, presence)
  photography_style_detailed JSONB,

  -- Illustration style (complexity, stroke, dimensionality, culture refs)
  illustration_style_detailed JSONB,

  -- Interior material & style preferences
  material_style_interior   JSONB,

  -- Fashion motif & style preferences
  motif_style_fashion       JSONB,

  -- Persistent creative memory (key insights, learnings, patterns)
  creative_memory_stored    JSONB,

  -- Per-dimension confidence scores with evidence + gaps
  dimension_confidence      JSONB,

  -- Structured recommendation explanations
  recommendation_explanations JSONB,

  -- Adapter provenance
  source_brand_dna_version  TEXT NOT NULL DEFAULT 'v1',
  source_analyzed_at        TIMESTAMP WITH TIME ZONE,

  analysis_version          TEXT NOT NULL DEFAULT 'v2',
  analyzed_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Unique constraint on client_id (one profile per client)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_brand_intelligence_v2_client_id_key'
      AND conrelid = 'ai_platform.ai_brand_intelligence_v2'::regclass
  ) THEN
    ALTER TABLE ai_platform.ai_brand_intelligence_v2
      ADD CONSTRAINT ai_brand_intelligence_v2_client_id_key UNIQUE (client_id);
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bi_v2_client_id
  ON ai_platform.ai_brand_intelligence_v2 (client_id);

CREATE INDEX IF NOT EXISTS idx_bi_v2_analyzed_at
  ON ai_platform.ai_brand_intelligence_v2 (analyzed_at DESC);

CREATE INDEX IF NOT EXISTS idx_bi_v2_analysis_version
  ON ai_platform.ai_brand_intelligence_v2 (analysis_version);
