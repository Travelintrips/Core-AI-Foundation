-- DDL: ai_quotations, ai_quotation_items, and additive column changes
-- Run once against the Supabase dev/prod database.
-- All tables live in the ai_platform schema.

SET search_path TO ai_platform, public;

-- ── ai_quotations ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.ai_quotations (
  id                       serial PRIMARY KEY,
  tenant_id                text,
  quotation_code           text NOT NULL UNIQUE,
  service_request_id       integer REFERENCES ai_platform.ai_service_requests(id) ON DELETE SET NULL,
  customer_name            text NOT NULL,
  customer_email           text NOT NULL,
  currency                 text NOT NULL DEFAULT 'IDR',
  subtotal                 integer NOT NULL DEFAULT 0,
  discount                 integer NOT NULL DEFAULT 0,
  tax                      integer NOT NULL DEFAULT 0,
  total                    integer NOT NULL DEFAULT 0,
  pricing_snapshot_json    jsonb,
  scope_snapshot_json      jsonb,
  terms_snapshot_json      jsonb,
  valid_until              timestamptz,
  status                   text NOT NULL DEFAULT 'draft',
  review_token_hash        text UNIQUE,
  review_token_expires_at  timestamptz,
  issued_at                timestamptz,
  viewed_at                timestamptz,
  approved_at              timestamptz,
  rejected_at              timestamptz,
  revision_requested_at    timestamptz,
  revision_notes           text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- ── ai_quotation_items ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.ai_quotation_items (
  id             serial PRIMARY KEY,
  quotation_id   integer NOT NULL REFERENCES ai_platform.ai_quotations(id) ON DELETE CASCADE,
  item_type      text NOT NULL DEFAULT 'service',
  description    text NOT NULL,
  quantity       integer NOT NULL DEFAULT 1,
  unit_price     integer NOT NULL DEFAULT 0,
  amount         integer NOT NULL DEFAULT 0,
  metadata_json  jsonb,
  display_order  integer NOT NULL DEFAULT 0
);

-- ── creative_projects: legacy-compat columns ──────────────────────────────────

ALTER TABLE ai_platform.creative_projects
  ADD COLUMN IF NOT EXISTS source_type          text NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS service_request_id   integer REFERENCES ai_platform.ai_service_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS service_quotation_id integer REFERENCES ai_platform.ai_quotations(id) ON DELETE SET NULL;

-- ── ai_commercial_gates: support new service-catalog flow ─────────────────────

ALTER TABLE ai_platform.ai_commercial_gates
  ALTER COLUMN quotation_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS service_quotation_id integer REFERENCES ai_platform.ai_quotations(id) ON DELETE SET NULL;
