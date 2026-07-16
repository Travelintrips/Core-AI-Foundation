-- =============================================================================
-- Team 7 — Universal Design Blueprint Library — Migration Draft
-- =============================================================================
-- STATUS: DRAFT — DO NOT EXECUTE
-- This file is a migration draft for Team 24 to review and execute.
-- All statements use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS — safe to re-run.
-- No DROP, no TRUNCATE, no destructive renames, no changes to other domains' tables.
-- search_path must be set to ai_platform before executing.
-- =============================================================================

SET search_path TO ai_platform, public;

-- ---------------------------------------------------------------------------
-- Table: ai_design_blueprints
-- Stores custom (user-created) blueprints. Built-in blueprints live in code.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_design_blueprints (
  id             SERIAL PRIMARY KEY,
  public_id      TEXT        NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  slug           TEXT        NOT NULL UNIQUE,
  schema_version TEXT        NOT NULL DEFAULT '1.0',
  domain         TEXT        NOT NULL CHECK (domain IN (
                   'graphic_design', 'presentation', 'interior',
                   'fashion', 'packaging', 'product_design'
                 )),
  name           TEXT        NOT NULL,
  description    TEXT        NOT NULL DEFAULT '',
  version        TEXT        NOT NULL DEFAULT '1.0.0',
  status         TEXT        NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'active', 'deprecated')),

  -- JSON columns (validated by blueprintValidator before insert)
  dimensions_json     JSONB NOT NULL DEFAULT '{}',
  zones_json          JSONB NOT NULL DEFAULT '[]',
  slots_json          JSONB NOT NULL DEFAULT '[]',
  constraints_json    JSONB NOT NULL DEFAULT '{}',
  components_json     JSONB NOT NULL DEFAULT '[]',
  required_data_json  JSONB NOT NULL DEFAULT '[]',
  outputs_json        JSONB NOT NULL DEFAULT '[]',
  industry_tags       TEXT[] NOT NULL DEFAULT '{}',
  style_tags          TEXT[] NOT NULL DEFAULT '{}',

  -- Audit
  created_by     TEXT        NOT NULL DEFAULT 'system',
  updated_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);

COMMENT ON TABLE ai_design_blueprints IS 'Custom blueprint records for the Universal Design Blueprint Library (Team 7). Built-in blueprints live in code (services/design-blueprints/blueprints/).';

-- ---------------------------------------------------------------------------
-- Table: ai_blueprint_validation_log
-- Audit trail for every validation request (validate, check-compat, normalize).
-- Append-only — no updates, no deletes.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_blueprint_validation_log (
  id              SERIAL PRIMARY KEY,
  blueprint_id    TEXT,                -- NULL for ad-hoc validate calls
  operation       TEXT NOT NULL CHECK (operation IN ('validate', 'check_compatibility', 'normalize')),
  payload_hash    TEXT,                -- SHA-256 of the input payload
  result_valid    BOOLEAN NOT NULL,
  issue_count     INTEGER NOT NULL DEFAULT 0,
  error_codes     TEXT[] NOT NULL DEFAULT '{}',
  requested_by    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE ai_blueprint_validation_log IS 'Audit log for blueprint validation, compatibility check, and normalize operations (Team 7). Append-only.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ai_design_blueprints_domain
  ON ai_design_blueprints (domain)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ai_design_blueprints_status
  ON ai_design_blueprints (status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ai_design_blueprints_industry_tags
  ON ai_design_blueprints USING gin (industry_tags)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ai_design_blueprints_style_tags
  ON ai_design_blueprints USING gin (style_tags)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ai_blueprint_validation_log_blueprint_id
  ON ai_blueprint_validation_log (blueprint_id)
  WHERE blueprint_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_blueprint_validation_log_operation
  ON ai_blueprint_validation_log (operation, created_at DESC);

-- ---------------------------------------------------------------------------
-- Trigger: auto-update updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ai_platform.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_ai_design_blueprints_updated_at'
  ) THEN
    CREATE TRIGGER trg_ai_design_blueprints_updated_at
      BEFORE UPDATE ON ai_design_blueprints
      FOR EACH ROW EXECUTE FUNCTION ai_platform.update_updated_at_column();
  END IF;
END;
$$;
