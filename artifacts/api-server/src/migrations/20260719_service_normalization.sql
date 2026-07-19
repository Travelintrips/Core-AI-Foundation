-- Migration: Service Normalization & Solution Collections (Team 04, V4.2E / V4.2H)
-- ADDITIVE ONLY — no existing table is modified, renamed, or dropped.
-- All FKs use RESTRICT to prevent silent cascade deletion of normalization metadata.
-- Run against: ai_platform schema (dev first, then prod with explicit approval)
--
-- STATUS: MIGRATION CREATED BUT NOT APPLIED
-- Apply explicitly via psql or Supabase SQL editor after owner review.

SET search_path TO ai_platform, public;

-- ── 1. service_canonical_concepts ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS service_canonical_concepts (
  id              SERIAL       PRIMARY KEY,
  code            TEXT         NOT NULL UNIQUE,    -- stable, e.g. "cc_branding_logo"
  slug            TEXT         NOT NULL UNIQUE,    -- url-safe, e.g. "branding-logo"
  name            TEXT         NOT NULL,
  short_description TEXT,
  status          TEXT         NOT NULL DEFAULT 'active',  -- active | draft | archived
  display_order   INTEGER      NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Lookup by code and slug are the two primary access patterns
CREATE INDEX IF NOT EXISTS idx_scc_code   ON service_canonical_concepts (code);
CREATE INDEX IF NOT EXISTS idx_scc_slug   ON service_canonical_concepts (slug);
CREATE INDEX IF NOT EXISTS idx_scc_status ON service_canonical_concepts (status);

-- ── 2. service_normalization_mappings ──────────────────────────────────────────
-- FK deletion rationale:
--   canonical_concept_id → RESTRICT: cannot delete a concept that still has service mappings
--   service_id           → RESTRICT: cannot delete a service that is part of a normalization
CREATE TABLE IF NOT EXISTS service_normalization_mappings (
  id                   SERIAL       PRIMARY KEY,
  canonical_concept_id INTEGER      NOT NULL
    REFERENCES service_canonical_concepts (id) ON DELETE RESTRICT,
  service_id           INTEGER      NOT NULL
    REFERENCES ai_services (id) ON DELETE RESTRICT,
  relationship_type    TEXT         NOT NULL DEFAULT 'related',
    -- primary | alias_variant | format_variant | tier_variant | legacy | related
  is_primary           BOOLEAN      NOT NULL DEFAULT FALSE,
  review_notes         TEXT,        -- INTERNAL ONLY — never returned in public API
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Uniqueness on service_id enforces one concept per service.
-- is_primary constraint (only one primary per concept) is enforced in the service layer
-- to allow a richer error message than a DB unique violation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_snm_service_unique
  ON service_normalization_mappings (service_id);

CREATE INDEX IF NOT EXISTS idx_snm_concept
  ON service_normalization_mappings (canonical_concept_id);

CREATE INDEX IF NOT EXISTS idx_snm_primary
  ON service_normalization_mappings (canonical_concept_id, is_primary)
  WHERE is_primary = TRUE;

-- ── 3. service_aliases ────────────────────────────────────────────────────────
-- FK deletion rationale:
--   canonical_concept_id → RESTRICT: cannot delete a concept that still has aliases
CREATE TABLE IF NOT EXISTS service_aliases (
  id                   SERIAL       PRIMARY KEY,
  canonical_concept_id INTEGER      NOT NULL
    REFERENCES service_canonical_concepts (id) ON DELETE RESTRICT,
  alias                TEXT         NOT NULL,
  normalized_alias     TEXT         NOT NULL,  -- trim().toLowerCase() — for dedup
  alias_type           TEXT         NOT NULL DEFAULT 'name',
    -- name | legacy_code | language_variant | typo
  locale               TEXT         NOT NULL DEFAULT 'any',
  status               TEXT         NOT NULL DEFAULT 'active',  -- active | deprecated
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
