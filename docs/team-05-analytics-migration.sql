-- =============================================================================
-- V4.2I — Team 05 Analytics & Feature Flags Migration
-- =============================================================================
-- Target schema : ai_platform
-- Author        : Team 05 — Analytics, Conversion & Production Readiness
-- Safety        : Additive only. No DROP, ALTER TABLE, or destructive SQL.
-- Idempotency   : Every statement uses IF NOT EXISTS — safe to run multiple times.
-- Apply status  : MIGRATION CREATED BUT NOT APPLIED
--                 Do not run against production without owner approval.
-- =============================================================================

SET search_path TO ai_platform, public;

-- ---------------------------------------------------------------------------
-- 1. Raw discovery events
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai_platform.ai_discovery_events (
    id            SERIAL PRIMARY KEY,
    event_id      TEXT        NOT NULL,
    event_name    TEXT        NOT NULL,
    event_version INTEGER     NOT NULL DEFAULT 1,
    occurred_at   TIMESTAMPTZ NOT NULL,
    received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    session_id    TEXT        NOT NULL,
    anonymous_user_id TEXT,
    customer_id   INTEGER,
    tenant_id     TEXT,
    environment   TEXT        NOT NULL DEFAULT 'production',
    source        TEXT,
    page_path     TEXT,
    referrer_type TEXT,
    goal_slug     TEXT,
    service_code  TEXT,
    collection_slug TEXT,
    category_code TEXT,
    request_id    TEXT,
    quote_id      TEXT,
    order_id      TEXT,
    experiment_key TEXT,
    metadata      JSONB,
    is_duplicate  BOOLEAN     NOT NULL DEFAULT FALSE,
    duplicate_of  TEXT
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS ai_discovery_events_event_id_idx
    ON ai_platform.ai_discovery_events (event_id);

CREATE INDEX IF NOT EXISTS ai_discovery_events_event_name_idx
    ON ai_platform.ai_discovery_events (event_name);

CREATE INDEX IF NOT EXISTS ai_discovery_events_occurred_at_idx
    ON ai_platform.ai_discovery_events (occurred_at);

CREATE INDEX IF NOT EXISTS ai_discovery_events_session_idx
    ON ai_platform.ai_discovery_events (session_id);

CREATE INDEX IF NOT EXISTS ai_discovery_events_goal_slug_idx
    ON ai_platform.ai_discovery_events (goal_slug);

CREATE INDEX IF NOT EXISTS ai_discovery_events_service_code_idx
    ON ai_platform.ai_discovery_events (service_code);

CREATE INDEX IF NOT EXISTS ai_discovery_events_collection_slug_idx
    ON ai_platform.ai_discovery_events (collection_slug);

CREATE INDEX IF NOT EXISTS ai_discovery_events_tenant_idx
    ON ai_platform.ai_discovery_events (tenant_id);

CREATE INDEX IF NOT EXISTS ai_discovery_events_env_idx
    ON ai_platform.ai_discovery_events (environment);

-- ---------------------------------------------------------------------------
-- 2. Deduplication window table (24 h TTL entries)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai_platform.ai_discovery_event_dedup (
    id         SERIAL PRIMARY KEY,
    event_id   TEXT        NOT NULL,
    seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_disc_dedup_event_id_idx
    ON ai_platform.ai_discovery_event_dedup (event_id);

CREATE INDEX IF NOT EXISTS ai_disc_dedup_expires_at_idx
    ON ai_platform.ai_discovery_event_dedup (expires_at);

-- ---------------------------------------------------------------------------
-- 3. Daily aggregate metrics
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai_platform.ai_discovery_daily_metrics (
    id               SERIAL PRIMARY KEY,
    metric_date      TEXT    NOT NULL,
    event_name       TEXT    NOT NULL,
    goal_slug        TEXT,
    service_code     TEXT,
    collection_slug  TEXT,
    source           TEXT,
    tenant_id        TEXT,
    environment      TEXT    NOT NULL DEFAULT 'production',
    event_count      INTEGER NOT NULL DEFAULT 0,
    unique_sessions  INTEGER NOT NULL DEFAULT 0,
    unique_users     INTEGER NOT NULL DEFAULT 0,
    computed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_disc_daily_date_event_idx
    ON ai_platform.ai_discovery_daily_metrics (metric_date, event_name);

CREATE INDEX IF NOT EXISTS ai_disc_daily_goal_idx
    ON ai_platform.ai_discovery_daily_metrics (goal_slug);

CREATE INDEX IF NOT EXISTS ai_disc_daily_env_idx
    ON ai_platform.ai_discovery_daily_metrics (environment);

-- ---------------------------------------------------------------------------
-- 4. Funnel step metrics
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai_platform.ai_discovery_funnel_metrics (
    id              SERIAL PRIMARY KEY,
    metric_date     TEXT    NOT NULL,
    funnel_name     TEXT    NOT NULL,
    step_name       TEXT    NOT NULL,
    step_order      INTEGER NOT NULL,
    session_count   INTEGER NOT NULL DEFAULT 0,
    conversion_rate NUMERIC(6, 3),
    drop_off_rate   NUMERIC(6, 3),
    environment     TEXT    NOT NULL DEFAULT 'production',
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_disc_funnel_date_idx
    ON ai_platform.ai_discovery_funnel_metrics (metric_date);

CREATE INDEX IF NOT EXISTS ai_disc_funnel_name_idx
    ON ai_platform.ai_discovery_funnel_metrics (funnel_name);

-- ---------------------------------------------------------------------------
-- 5. Feature flags
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai_platform.ai_feature_flags (
    id               SERIAL PRIMARY KEY,
    flag_key         TEXT        NOT NULL,
    description      TEXT,
    enabled          BOOLEAN     NOT NULL DEFAULT FALSE,
    environment      TEXT        NOT NULL DEFAULT 'production',
    rollout_percent  INTEGER     NOT NULL DEFAULT 0,
    metadata         JSONB,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by       TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_feature_flags_key_env_idx
    ON ai_platform.ai_feature_flags (flag_key, environment);

CREATE INDEX IF NOT EXISTS ai_feature_flags_enabled_idx
    ON ai_platform.ai_feature_flags (enabled);

-- ---------------------------------------------------------------------------
-- 6. Seed default V4.2 feature flags (idempotent)
-- ---------------------------------------------------------------------------

INSERT INTO ai_platform.ai_feature_flags
    (flag_key, description, enabled, environment, rollout_percent, updated_by)
VALUES
    -- Production: conservative defaults
    ('v4_2_goal_discovery_enabled',
     'Enables V4.2 goal-based discovery section in marketplace',
     FALSE, 'production', 0, 'migration/v4.2i'),
    ('v4_2_solution_collections_enabled',
     'Enables V4.2 solution collections in marketplace',
     FALSE, 'production', 0, 'migration/v4.2i'),
    ('v4_2_discovery_analytics_enabled',
     'Enables V4.2 analytics event capture',
     TRUE, 'production', 100, 'migration/v4.2i'),
    ('v4_2_new_marketplace_default',
     'Makes V4.2 marketplace the default experience',
     FALSE, 'production', 0, 'migration/v4.2i'),
    -- Development: all enabled
    ('v4_2_goal_discovery_enabled',
     'Enables V4.2 goal-based discovery section in marketplace',
     TRUE, 'development', 100, 'migration/v4.2i'),
    ('v4_2_solution_collections_enabled',
     'Enables V4.2 solution collections in marketplace',
     TRUE, 'development', 100, 'migration/v4.2i'),
    ('v4_2_discovery_analytics_enabled',
     'Enables V4.2 analytics event capture',
     TRUE, 'development', 100, 'migration/v4.2i'),
    ('v4_2_new_marketplace_default',
     'Makes V4.2 marketplace the default experience',
     FALSE, 'development', 0, 'migration/v4.2i')
ON CONFLICT (flag_key, environment) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. Retention policy note (enforced via cron / pg_cron — not included here)
-- ---------------------------------------------------------------------------
-- Raw events (ai_discovery_events): 90-day retention
--   DELETE FROM ai_platform.ai_discovery_events WHERE occurred_at < now() - interval '90 days';
--
-- Dedup table: self-expiring via expires_at column (24 h)
--   DELETE FROM ai_platform.ai_discovery_event_dedup WHERE expires_at < now();
--
-- Daily/funnel aggregates: permanent (no retention limit)
--
-- Anonymous user IDs: stored in localStorage client-side; cleared when user
--   clears browser storage. No server-side deletion needed.
--
-- Cron implementation: DEFERRED — implement via pg_cron or a scheduled API
--   endpoint once the migration is applied and volumes justify it.

-- =============================================================================
-- MIGRATION CREATED BUT NOT APPLIED
-- Apply only after:
--   1. Owner approval
--   2. Confirm active branch = feature/v4.2i-analytics-production-readiness
--   3. Confirm target DB (dev: SUPABASE_DEV_DATABASE_URL, prod: SUPABASE_PROD_DATABASE_URL)
--   4. Verify additive-only (no destructive SQL above)
--   5. Run: psql $SUPABASE_DEV_DATABASE_URL -f docs/team-05-analytics-migration.sql
-- =============================================================================
