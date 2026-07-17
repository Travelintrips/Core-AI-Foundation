-- ============================================================================
-- Team 03 — Creative Commercial Automation
-- Migration Draft: integration/migrations/team-03.sql
--
-- STATUS: DRAFT — Do NOT run. Team 24 runs all migrations.
--
-- Rules obeyed:
--   - Additive only (no DROP, no TRUNCATE, no destructive rename)
--   - Does not touch any tables owned by other teams
--   - All indexes use CREATE INDEX IF NOT EXISTS
--   - All tables use IF NOT EXISTS
--   - All columns use ADD COLUMN IF NOT EXISTS
--   - Schema: ai_platform (shared search_path, set at session level by infra)
--
-- Audit remediation notes (P0 + P1):
--
--   P0 — Schema ownership:
--     lib/db/src/schema/sales-funnel-events.ts was NOT added by this branch.
--     It exists in main (added in commit 3a821a1). This migration draft reads
--     sales_funnel_events via raw SQL only — no Drizzle table import used.
--
--   P1 — Duplicate approval state machine removed:
--     cc_pending_approvals table is NOT included in this migration.
--     Approval state is managed via existing ai_commercial_gates table
--     (gate_type='admin_approval') using the existing commercialGateService.
--     No parallel state machine is created by Team 03.
--     Manifest documents the dependency on ai_commercial_gates.
-- ============================================================================

-- ── 1. cc_recommendation_log ─────────────────────────────────────────────────
-- Stores recommendation delivery records for cooldown + idempotency.
-- One row per (customer, recType, contextKey) window.

CREATE TABLE IF NOT EXISTS ai_platform.cc_recommendation_log (
  id                   SERIAL PRIMARY KEY,
  customer_profile_id  INTEGER NOT NULL,
  rec_type             TEXT    NOT NULL,           -- RecommendationType enum value
  context_key          TEXT    NOT NULL,           -- e.g. "pkg:7", "coupon:42", "repeat:svc:3"
  payload_json         JSONB   NOT NULL DEFAULT '{}',
  cooldown_until       TIMESTAMPTZ NOT NULL,       -- next eligible time
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cc_rec_log_lookup
  ON ai_platform.cc_recommendation_log (customer_profile_id, rec_type, context_key, cooldown_until);

CREATE INDEX IF NOT EXISTS idx_cc_rec_log_customer_created
  ON ai_platform.cc_recommendation_log (customer_profile_id, created_at DESC);

-- ── 2. cc_attribution_touchpoints ─────────────────────────────────────────────
-- Attribution read model: records each marketing touchpoint per customer.
-- Pure read model — commercial source of truth is not modified here.

CREATE TABLE IF NOT EXISTS ai_platform.cc_attribution_touchpoints (
  id                   SERIAL PRIMARY KEY,
  customer_profile_id  INTEGER NOT NULL,
  service_request_id   INTEGER,                   -- nullable FK (not enforced — cross-team table)
  touchpoint_type      TEXT    NOT NULL,           -- TouchpointType enum value
  source               TEXT    NOT NULL,           -- utm_source or inferred
  medium               TEXT,                       -- utm_medium
  campaign             TEXT,                       -- utm_campaign
  weight               NUMERIC(5,4) NOT NULL DEFAULT 0, -- 0–1 attribution weight (calculated post-insert)
  occurred_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cc_attribution_customer
  ON ai_platform.cc_attribution_touchpoints (customer_profile_id, occurred_at ASC);

CREATE INDEX IF NOT EXISTS idx_cc_attribution_request
  ON ai_platform.cc_attribution_touchpoints (service_request_id)
  WHERE service_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cc_attribution_source
  ON ai_platform.cc_attribution_touchpoints (source, touchpoint_type, occurred_at DESC);

-- ── 3. cc_funnel_snapshots ────────────────────────────────────────────────────
-- Daily funnel projection snapshots for trend analysis.
-- Written by funnelProjectionService on each projection request (upserted).

CREATE TABLE IF NOT EXISTS ai_platform.cc_funnel_snapshots (
  id                   SERIAL PRIMARY KEY,
  snapshot_date        DATE    NOT NULL,
  stage                TEXT    NOT NULL,           -- FunnelStage enum value
  cnt                  INTEGER NOT NULL DEFAULT 0,
  conversion_rate      NUMERIC(6,4) NOT NULL DEFAULT 0,
  projected_revenue    BIGINT  NOT NULL DEFAULT 0,
  projected_orders     INTEGER NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (snapshot_date, stage)
);

CREATE INDEX IF NOT EXISTS idx_cc_funnel_snapshots_date
  ON ai_platform.cc_funnel_snapshots (snapshot_date DESC, stage);

-- ── END OF MIGRATION DRAFT ────────────────────────────────────────────────────
-- Total new tables: 3 (cc_recommendation_log, cc_attribution_touchpoints, cc_funnel_snapshots)
-- Total new indexes: 6
-- No shared tables modified.
-- No data dropped.
--
-- Approval state: uses existing ai_commercial_gates (no new table needed).
-- Dependency: ai_commercial_gates must exist before mounting routes.
-- The commercialGateService handles the gate lifecycle; Team 03 is a consumer.
