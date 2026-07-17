-- =============================================================================
-- Team 11 — Universal Template Matching — Migration Draft
-- =============================================================================
-- Status : DRAFT — NOT YET APPLIED
-- Rules  : additive only, no DROP, no TRUNCATE, no destructive rename,
--          no changes to other teams' tables, CREATE INDEX IF NOT EXISTS.
--
-- MVP Note:
--   The matching engine reads from the existing ai_platform.ai_templates table
--   via the BlueprintPort abstraction. No new tables are strictly required
--   for MVP operation.
--
--   This migration adds two optional enhancement tables:
--     1. ai_blueprint_constraint_registry — explicit constraint deny-lists
--        per blueprint (extends what ai_templates.brand_dna_tags can express).
--     2. ai_template_matching_logs — audit trail of matching requests for
--        analytics and confidence improvement over time.
--
--   Both tables are additive. The engine works without them (adapters fall
--   back gracefully to empty constraint lists).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ai_blueprint_constraint_registry
--    Maps blueprint IDs to constraints they explicitly cannot satisfy.
--    Populated by admin tooling; read by the BlueprintPort adapter.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_platform.ai_blueprint_constraint_registry (
    id              SERIAL PRIMARY KEY,
    template_id     INTEGER NOT NULL
                        REFERENCES ai_platform.ai_templates(id) ON DELETE CASCADE,
    constraint_key  TEXT    NOT NULL,  -- e.g. 'dark-mode', 'bilingual', 'print-ready'
    reason          TEXT,              -- human note explaining why not supported
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ai_platform.ai_blueprint_constraint_registry IS
    'Explicit constraint deny-list per blueprint. Rows here cause hard rejection in matching.';

CREATE INDEX IF NOT EXISTS idx_blueprint_constraint_template_id
    ON ai_platform.ai_blueprint_constraint_registry (template_id);

CREATE INDEX IF NOT EXISTS idx_blueprint_constraint_key
    ON ai_platform.ai_blueprint_constraint_registry (constraint_key);

-- Prevent duplicate entries for the same template + constraint pair
CREATE UNIQUE INDEX IF NOT EXISTS uidx_blueprint_constraint_pair
    ON ai_platform.ai_blueprint_constraint_registry (template_id, constraint_key);

-- -----------------------------------------------------------------------------
-- 2. ai_template_matching_logs
--    Records every matching request for analytics.
--    Used to improve confidence calibration and surface popular signal combos.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_platform.ai_template_matching_logs (
    id                      BIGSERIAL PRIMARY KEY,
    -- Input signals summary (no PII stored)
    service_type            TEXT,
    domain                  TEXT,
    category                TEXT,
    industry                TEXT,
    package_level           TEXT,
    signals_used            TEXT[]  NOT NULL DEFAULT '{}',
    signals_missing         TEXT[]  NOT NULL DEFAULT '{}',
    constraints_applied     TEXT[]  NOT NULL DEFAULT '{}',
    -- Result summary
    candidates_evaluated    INTEGER NOT NULL DEFAULT 0,
    top_blueprint_id        TEXT,       -- null if no result
    top_score               INTEGER,    -- 0-100
    confidence              NUMERIC(4,3),
    rejected_count          INTEGER NOT NULL DEFAULT 0,
    -- Caller context
    caller_service          TEXT,       -- which service called the matcher
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ai_platform.ai_template_matching_logs IS
    'Audit log of template matching requests. No PII. Used for confidence analytics.';

CREATE INDEX IF NOT EXISTS idx_matching_logs_created_at
    ON ai_platform.ai_template_matching_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_matching_logs_service_type
    ON ai_platform.ai_template_matching_logs (service_type)
    WHERE service_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_matching_logs_top_blueprint
    ON ai_platform.ai_template_matching_logs (top_blueprint_id)
    WHERE top_blueprint_id IS NOT NULL;
