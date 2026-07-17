-- ─────────────────────────────────────────────────────────────────────────────
-- Team 20 — Product Concept Design  (DRAFT — DO NOT RUN DIRECTLY)
--
-- Migration draft for Team 24 review.
-- Rules enforced:
--   • All DDL is ADDITIVE ONLY — no DROP, no ALTER COLUMN type changes.
--   • All tables live in the ai_platform schema.
--   • All identifiers prefixed with pcd_ to avoid collisions.
--   • No foreign keys into other teams' tables (Team 24 adds cross-refs).
--   • Indexes use IF NOT EXISTS.
--   • JSONB for flexible concept sub-documents; critical fields promoted to columns.
--
-- TEAM 20 OWNED — do not modify outside feature/20-product-design.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Product Concepts ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.pcd_product_concepts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        TEXT        NOT NULL,

  -- Human-readable name
  name              TEXT        NOT NULL,

  -- Status lifecycle: draft → in_review → approved → archived
  status            TEXT        NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft', 'in_review', 'approved', 'archived')),

  -- Promoted columns for filtering / reporting
  form_category     TEXT        NOT NULL,
  primary_material  TEXT        NOT NULL,

  -- Full sub-documents stored as JSONB
  form_direction    JSONB       NOT NULL,
  material_direction JSONB      NOT NULL,
  cmf               JSONB       NOT NULL,
  feature_placements JSONB      NOT NULL DEFAULT '[]',
  label_areas        JSONB      NOT NULL DEFAULT '[]',

  -- Mandatory disclaimer — populated server-side, never null
  disclaimer        TEXT        NOT NULL,

  -- Versioning
  version           INTEGER     NOT NULL DEFAULT 1 CHECK (version >= 1),

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes on pcd_product_concepts
CREATE INDEX IF NOT EXISTS pcd_concepts_project_id_idx
  ON ai_platform.pcd_product_concepts (project_id);

CREATE INDEX IF NOT EXISTS pcd_concepts_status_idx
  ON ai_platform.pcd_product_concepts (status);

CREATE INDEX IF NOT EXISTS pcd_concepts_form_category_idx
  ON ai_platform.pcd_product_concepts (form_category);

CREATE INDEX IF NOT EXISTS pcd_concepts_updated_at_idx
  ON ai_platform.pcd_product_concepts (updated_at DESC);

-- ── 2. Product Mockups ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.pcd_product_mockups (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References pcd_product_concepts.id
  -- No FK constraint defined here — Team 24 adds cross-table constraints
  concept_id         UUID        NOT NULL,

  view_angle         TEXT        NOT NULL
                                 CHECK (view_angle IN ('front','back','left','right','top','isometric_left','isometric_right')),
  format             TEXT        NOT NULL
                                 CHECK (format IN ('png','svg','pdf','jpg')),
  width_px           INTEGER     NOT NULL CHECK (width_px > 0),
  height_px          INTEGER     NOT NULL CHECK (height_px > 0),

  -- Layer stack as JSONB array
  layers             JSONB       NOT NULL DEFAULT '[]',

  -- Set by composition port after rendering
  rendered_asset_key TEXT,
  rendered           BOOLEAN     NOT NULL DEFAULT false,

  -- Mandatory disclaimer on every mockup
  disclaimer         TEXT        NOT NULL,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pcd_mockups_concept_id_idx
  ON ai_platform.pcd_product_mockups (concept_id);

CREATE INDEX IF NOT EXISTS pcd_mockups_rendered_idx
  ON ai_platform.pcd_product_mockups (rendered);

-- ── 3. Concept Variants ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.pcd_concept_variants (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References pcd_product_concepts.id
  base_concept_id  UUID        NOT NULL,

  name             TEXT        NOT NULL,

  -- Non-empty JSONB array of VariantDelta objects
  deltas           JSONB       NOT NULL DEFAULT '[]',

  -- Result of automatic consistency check
  consistency_check JSONB,

  -- Mandatory disclaimer
  disclaimer       TEXT        NOT NULL,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pcd_variants_base_concept_id_idx
  ON ai_platform.pcd_concept_variants (base_concept_id);

-- ── 4. Manufacturer Briefs ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.pcd_manufacturer_briefs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References pcd_product_concepts.id
  concept_id     UUID        NOT NULL,
  concept_name   TEXT        NOT NULL,

  -- Process hints array stored as JSONB
  process_hints  JSONB       NOT NULL DEFAULT '[]',

  -- Requirement entries as JSONB array
  requirements   JSONB       NOT NULL DEFAULT '[]',

  logistics_notes TEXT,

  -- Mandatory disclaimer — must be present on every generated brief
  disclaimer     TEXT        NOT NULL,

  generated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pcd_briefs_concept_id_idx
  ON ai_platform.pcd_manufacturer_briefs (concept_id);

CREATE INDEX IF NOT EXISTS pcd_briefs_generated_at_idx
  ON ai_platform.pcd_manufacturer_briefs (generated_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- END OF DRAFT
-- Team 24: run this in a transaction with ROLLBACK test before committing.
-- All tables are additive; no existing rows or columns are modified.
-- ─────────────────────────────────────────────────────────────────────────────
