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

-- ── 2. cc_pending_approvals ───────────────────────────────────────────────────
-- Financial actions that require manager approval before execution.
-- Approval triggers a commercial.approval.granted event on the event bus.

CREATE TABLE IF NOT EXISTS ai_platform.cc_pending_approvals (
  id                   SERIAL PRIMARY KEY,
  customer_profile_id  INTEGER NOT NULL,
  action_type          TEXT    NOT NULL,           -- ApprovalActionType enum value
  action_payload       JSONB   NOT NULL DEFAULT '{}',
  requested_by         TEXT    NOT NULL,
  status               TEXT    NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | expired
  approved_by          TEXT,
  approved_at          TIMESTAMPTZ,
  expires_at           TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cc_approvals_pending
  ON ai_platform.cc_pending_approvals (status, expires_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_cc_approvals_customer
  ON ai_platform.cc_pending_approvals (customer_profile_id, status, created_at DESC);

-- ── 3. cc_attribution_touchpoints ─────────────────────────────────────────────
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

-- ── 4. cc_funnel_snapshots ────────────────────────────────────────────────────
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
-- Total new tables: 4
-- Total new indexes: 8
-- No shared tables modified.
-- No data dropped.
