-- Team 04 — Service Normalization & Solution Collections
-- V4.2E migration
--
-- Safety properties:
--   - All statements use IF NOT EXISTS / IF EXISTS — repeat-safe (idempotent)
--   - Purely additive — zero existing tables modified or dropped
--   - No destructive backfills
--   - No hardcoded production IDs
--   - References ai_services which exists after Team 01/02 migrations
--   - Uses ON DELETE RESTRICT throughout (no cascade deletions)
--   - Runs inside a single transaction
--
-- Ordering relative to other Team migrations:
--   Must run AFTER: core schema (ai_services, ai_service_categories exist)
--   Must run AFTER: Team 01 commercial policy migration
--   Must run AFTER: Team 02 goal taxonomy migration (9932e0a)
--
-- Search path is set to ai_platform (matching the rest of the codebase).

BEGIN;

SET search_path TO ai_platform, public;

-- ── 1. service_canonical_concepts ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS service_canonical_concepts (
  id               SERIAL       PRIMARY KEY,
  code             TEXT         NOT NULL UNIQUE,   -- e.g. "cc_branding_logo"
  slug             TEXT         NOT NULL UNIQUE,   -- e.g. "branding-logo"
  name             TEXT         NOT NULL,
  short_description TEXT,
  status           TEXT         NOT NULL DEFAULT 'active',   -- active | draft | archived
  display_order    INTEGER      NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scc_code   ON service_canonical_concepts (code);
CREATE INDEX IF NOT EXISTS idx_scc_slug   ON service_canonical_concepts (slug);
CREATE INDEX IF NOT EXISTS idx_scc_status ON service_canonical_concepts (status);

-- ── 2. service_normalization_mappings ─────────────────────────────────────────
-- FK deletion rationale:
--   canonical_concept_id → RESTRICT: deleting a concept that still has mappings is blocked
--   service_id           → RESTRICT: deleting a mapped service without removing the mapping is blocked
CREATE TABLE IF NOT EXISTS service_normalization_mappings (
  id                    SERIAL       PRIMARY KEY,
  canonical_concept_id  INTEGER      NOT NULL
    REFERENCES service_canonical_concepts (id) ON DELETE RESTRICT,
  service_id            INTEGER      NOT NULL
    REFERENCES ai_services (id) ON DELETE RESTRICT,
  relationship_type     TEXT         NOT NULL DEFAULT 'related',
    -- primary | alias_variant | format_variant | tier_variant | legacy | related
  is_primary            BOOLEAN      NOT NULL DEFAULT FALSE,
    -- At most ONE mapping per concept may be is_primary=TRUE (enforced in service layer)
  review_notes          TEXT,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- A service may only be mapped to one canonical concept
CREATE UNIQUE INDEX IF NOT EXISTS idx_snm_service
  ON service_normalization_mappings (service_id);

CREATE INDEX IF NOT EXISTS idx_snm_concept
  ON service_normalization_mappings (canonical_concept_id);

-- ── 3. service_aliases ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS service_aliases (
  id                   SERIAL       PRIMARY KEY,
  canonical_concept_id INTEGER      NOT NULL
    REFERENCES service_canonical_concepts (id) ON DELETE RESTRICT,
  alias                TEXT         NOT NULL,
  normalized_alias     TEXT         NOT NULL,   -- trim + lowercase form
  alias_type           TEXT         NOT NULL DEFAULT 'name',
    -- name | legacy_code | language_variant | typo
  locale               TEXT,
  status               TEXT         NOT NULL DEFAULT 'active',  -- active | archived
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Prevent duplicate aliases for the same concept
CREATE UNIQUE INDEX IF NOT EXISTS idx_sa_concept_normalized
  ON service_aliases (canonical_concept_id, normalized_alias);

CREATE INDEX IF NOT EXISTS idx_sa_concept
  ON service_aliases (canonical_concept_id);

CREATE INDEX IF NOT EXISTS idx_sa_normalized_alias
  ON service_aliases (normalized_alias);

-- ── 4. solution_collections ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solution_collections (
  id               SERIAL       PRIMARY KEY,
  code             TEXT         NOT NULL UNIQUE,   -- e.g. "sc_brand_launch"
  slug             TEXT         NOT NULL UNIQUE,   -- e.g. "brand-launch-essentials"
  name             TEXT         NOT NULL,
  short_description TEXT,
  status           TEXT         NOT NULL DEFAULT 'active',    -- active | draft | archived
  visibility       TEXT         NOT NULL DEFAULT 'public',    -- public | internal
  display_order    INTEGER      NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sc_slug       ON solution_collections (slug);
CREATE INDEX IF NOT EXISTS idx_sc_status_vis ON solution_collections (status, visibility);

-- ── 5. solution_collection_services ──────────────────────────────────────────
-- FK deletion rationale:
--   collection_id → RESTRICT: cannot delete a collection that has members
--   service_id    → RESTRICT: cannot delete a mapped service without removing membership first
CREATE TABLE IF NOT EXISTS solution_collection_services (
  id             SERIAL       PRIMARY KEY,
  collection_id  INTEGER      NOT NULL
    REFERENCES solution_collections (id) ON DELETE RESTRICT,
  service_id     INTEGER      NOT NULL
    REFERENCES ai_services (id) ON DELETE RESTRICT,
  display_order  INTEGER      NOT NULL DEFAULT 0,
  role           TEXT         NOT NULL DEFAULT 'complementary',
    -- anchor | complementary | optional
  is_optional    BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- A service may only appear once per collection
CREATE UNIQUE INDEX IF NOT EXISTS idx_scs_collection_service
  ON solution_collection_services (collection_id, service_id);

CREATE INDEX IF NOT EXISTS idx_scs_collection
  ON solution_collection_services (collection_id, display_order);

COMMIT;
