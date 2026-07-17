-- ============================================================
-- TEAM 06 — Asset Intelligence V2 Migration Draft
-- Branch: feature/06-asset-intelligence
-- Status: DRAFT — NOT YET APPLIED TO ANY DATABASE
--
-- Rules:
--   ✅ Additive only (CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS)
--   ✅ No DROP, no TRUNCATE, no destructive rename
--   ✅ No changes to tables owned by other teams
--   ✅ Uses CREATE INDEX IF NOT EXISTS
--   ✅ Schema: ai_platform (search_path must be set)
--
-- Remediations applied (vs original draft):
--   [P2]  Added content_sha256 column for exact-duplicate detection
--   [P2]  Added FK on ai_asset_intelligence_v2.version_chain_id
--   [P0]  Added GIN indexes on auto_tags + knowledge_tags for array overlap queries
--   [P0]  Added index on content_sha256 for exact-dup lookup
-- ============================================================

-- ── 1. Extended asset intelligence (v2) ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.ai_asset_intelligence_v2 (
  id                        SERIAL PRIMARY KEY,
  asset_id                  INTEGER NOT NULL,
  asset_source              TEXT    NOT NULL,       -- 'brand_kit' | 'library' | 'creative_asset'
  client_id                 TEXT    NOT NULL,        -- sha256 email hash

  -- Asset type (expanded taxonomy)
  asset_type_v2             TEXT,                   -- graphic | photo | illustration | svg | document |
                                                    -- interior_material | furniture_image | fashion_motif |
                                                    -- garment_mockup | packaging_asset

  -- [P1 HASH FIX] Content SHA-256 — PRIMARY exact-duplicate signal
  -- Sourced directly from the source table's checksum column (file SHA-256).
  -- Two assets are exact duplicates ONLY when both have a non-null content_sha256 that matches.
  -- Perceptual/metadata hash is a SECONDARY similarity heuristic only.
  content_sha256            TEXT,                   -- raw file SHA-256 (nullable — not all sources provide it)

  -- Tags
  auto_tags                 TEXT[]  NOT NULL DEFAULT '{}',
  normalized_tags           TEXT[]  NOT NULL DEFAULT '{}',
  knowledge_tags            TEXT[]  NOT NULL DEFAULT '{}',
  search_keywords           TEXT[]  NOT NULL DEFAULT '{}',
  detected_subjects         TEXT[]  NOT NULL DEFAULT '{}',

  -- Perceptual hash (secondary heuristic — similarity only)
  perceptual_hash           TEXT,
  hash_tier                 TEXT,                   -- 'full' | 'metadata'
  is_duplicate              BOOLEAN NOT NULL DEFAULT FALSE,
  duplicate_of_id           INTEGER,
  duplicate_similarity_score NUMERIC(5,2),

  -- Version
  version_type              TEXT    NOT NULL DEFAULT 'original',
  -- [P2 FK FIX] version_chain_id now has a proper FK reference
  version_chain_id          INTEGER REFERENCES ai_platform.ai_asset_version_chains(id) ON DELETE SET NULL,

  -- Quality
  quality_score             INTEGER,               -- 0–100
  quality_metadata          JSONB,                 -- QualityMetadataV2 struct

  -- Suggested usage
  suggested_usage           TEXT[]  NOT NULL DEFAULT '{}',

  -- Analysis state
  confidence_score          NUMERIC(4,3) NOT NULL DEFAULT 0,
  analysis_failed           BOOLEAN NOT NULL DEFAULT FALSE,
  failure_reason            TEXT,

  analyzed_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_ai_asset_intelligence_v2_asset UNIQUE (asset_id, asset_source)
);

COMMENT ON TABLE ai_platform.ai_asset_intelligence_v2 IS
  'Team 06 — Extended asset intelligence: knowledge taxonomy, quality scoring, duplicate detection v2.';
COMMENT ON COLUMN ai_platform.ai_asset_intelligence_v2.content_sha256 IS
  'Primary exact-duplicate signal: raw file SHA-256 from source table. Null when source does not provide checksum.';
COMMENT ON COLUMN ai_platform.ai_asset_intelligence_v2.perceptual_hash IS
  'Secondary similarity heuristic only. Never use alone for exact-duplicate determination.';

-- ── 2. Version chains ────────────────────────────────────────────────────────

-- Note: ai_asset_version_chains must exist BEFORE ai_asset_intelligence_v2
-- so that the FK in step 1 can resolve. Create it first if running standalone.

CREATE TABLE IF NOT EXISTS ai_platform.ai_asset_version_chains (
  id                  SERIAL PRIMARY KEY,
  client_id           TEXT    NOT NULL,
  primary_asset_id    INTEGER,                     -- FK to ai_asset_library.id (nullable)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ai_platform.ai_asset_version_chains IS
  'Team 06 — Groups all intentional variants (dark/light/transparent/icon) of the same logical asset.';

CREATE TABLE IF NOT EXISTS ai_platform.ai_asset_version_chain_members (
  id              SERIAL PRIMARY KEY,
  chain_id        INTEGER NOT NULL REFERENCES ai_platform.ai_asset_version_chains(id) ON DELETE CASCADE,
  asset_id        INTEGER NOT NULL,
  asset_source    TEXT    NOT NULL,
  version_type    TEXT    NOT NULL DEFAULT 'original',
  version_label   TEXT    NOT NULL,
  role            TEXT    NOT NULL DEFAULT 'variant',  -- 'primary' | 'variant'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_chain_member UNIQUE (chain_id, asset_id, asset_source)
);

-- ── 3. Licensing metadata placeholder ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.ai_asset_licensing (
  id              SERIAL PRIMARY KEY,
  asset_id        INTEGER NOT NULL,
  asset_source    TEXT    NOT NULL,
  client_id       TEXT    NOT NULL,

  license_type    TEXT    NOT NULL DEFAULT 'unknown',
                                                   -- proprietary | cc_by | cc_by_sa | cc_by_nd |
                                                   -- cc_by_nc | cc0 | royalty_free | rights_managed |
                                                   -- ai_generated | unknown
  license_owner   TEXT,                            -- SENSITIVE — not exposed to customer portal
  attribution     TEXT,
  usage_rights    TEXT[]  NOT NULL DEFAULT '{}',   -- commercial | print | web | social_media | internal
  restrictions    TEXT[]  NOT NULL DEFAULT '{}',
  expires_at      TIMESTAMPTZ,
  notes           TEXT,                            -- SENSITIVE — admin only

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_asset_licensing UNIQUE (asset_id, asset_source)
);

COMMENT ON TABLE ai_platform.ai_asset_licensing IS
  'Team 06 — Licensing metadata placeholder. license_owner and notes are admin-only (redacted in public API).';

-- ── 4. Asset safety ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.ai_asset_safety (
  id                  SERIAL PRIMARY KEY,
  asset_id            INTEGER NOT NULL,
  asset_source        TEXT    NOT NULL,
  client_id           TEXT    NOT NULL,

  safety_level        TEXT    NOT NULL DEFAULT 'safe',  -- safe | review | unsafe
  brand_safety_score  INTEGER NOT NULL DEFAULT 100,     -- 0–100
  flags               TEXT[]  NOT NULL DEFAULT '{}',
  review_required     BOOLEAN NOT NULL DEFAULT FALSE,
  auto_approved       BOOLEAN NOT NULL DEFAULT TRUE,
  notes               TEXT,

  classified_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_asset_safety UNIQUE (asset_id, asset_source)
);

COMMENT ON TABLE ai_platform.ai_asset_safety IS
  'Team 06 — Brand safety classification: safe | review | unsafe, with rule-based flag detection.';

-- ── Additive column for existing deployments ──────────────────────────────────
-- If the table already exists without content_sha256, add it:
ALTER TABLE ai_platform.ai_asset_intelligence_v2
  ADD COLUMN IF NOT EXISTS content_sha256 TEXT;

-- If the version_chain_id FK is not yet set, add it:
-- (FK cannot be added as IF NOT EXISTS in standard SQL; wrap in DO block)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_aiv2_version_chain'
      AND table_schema = 'ai_platform'
      AND table_name   = 'ai_asset_intelligence_v2'
  ) THEN
    ALTER TABLE ai_platform.ai_asset_intelligence_v2
      ADD CONSTRAINT fk_aiv2_version_chain
      FOREIGN KEY (version_chain_id)
      REFERENCES ai_platform.ai_asset_version_chains(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Existing indexes (retained from original draft)
CREATE INDEX IF NOT EXISTS idx_ai_asset_intel_v2_client
  ON ai_platform.ai_asset_intelligence_v2 (client_id);

CREATE INDEX IF NOT EXISTS idx_ai_asset_intel_v2_hash
  ON ai_platform.ai_asset_intelligence_v2 (perceptual_hash, hash_tier)
  WHERE perceptual_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_asset_intel_v2_type
  ON ai_platform.ai_asset_intelligence_v2 (asset_type_v2)
  WHERE asset_type_v2 IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_asset_intel_v2_duplicate
  ON ai_platform.ai_asset_intelligence_v2 (client_id, is_duplicate)
  WHERE is_duplicate = TRUE;

CREATE INDEX IF NOT EXISTS idx_ai_version_chains_client
  ON ai_platform.ai_asset_version_chains (client_id);

CREATE INDEX IF NOT EXISTS idx_ai_version_chain_members_chain
  ON ai_platform.ai_asset_version_chain_members (chain_id);

CREATE INDEX IF NOT EXISTS idx_ai_asset_licensing_client
  ON ai_platform.ai_asset_licensing (client_id);

CREATE INDEX IF NOT EXISTS idx_ai_asset_safety_client_level
  ON ai_platform.ai_asset_safety (client_id, safety_level);

CREATE INDEX IF NOT EXISTS idx_ai_asset_safety_flagged
  ON ai_platform.ai_asset_safety (client_id, review_required)
  WHERE review_required = TRUE;

-- [P0 NEW] GIN indexes for array overlap queries (used by findSimilarAssets &&)
CREATE INDEX IF NOT EXISTS idx_ai_asset_intel_v2_auto_tags_gin
  ON ai_platform.ai_asset_intelligence_v2 USING GIN (auto_tags);

CREATE INDEX IF NOT EXISTS idx_ai_asset_intel_v2_knowledge_tags_gin
  ON ai_platform.ai_asset_intelligence_v2 USING GIN (knowledge_tags);

-- [P1 NEW] Index for exact content SHA-256 duplicate lookup
CREATE INDEX IF NOT EXISTS idx_ai_asset_intel_v2_content_sha256
  ON ai_platform.ai_asset_intelligence_v2 (client_id, content_sha256)
  WHERE content_sha256 IS NOT NULL;

-- [P1 NEW] Composite index for paginated list query
CREATE INDEX IF NOT EXISTS idx_ai_asset_intel_v2_client_analyzed
  ON ai_platform.ai_asset_intelligence_v2 (client_id, analyzed_at DESC);
