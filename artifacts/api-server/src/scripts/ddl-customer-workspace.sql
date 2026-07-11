-- DDL: Customer Workspace additive schema changes
-- Run once against the Supabase dev/prod database.
-- All tables live in the ai_platform schema. Purely additive — no drops,
-- no column type changes, no data loss. Do NOT use drizzle-kit push (see
-- project memory: it false-positives a full schema drop on this database).

SET search_path TO ai_platform, public;

-- ── customer_profiles ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.customer_profiles (
  id                      serial PRIMARY KEY,
  email_hash              text NOT NULL UNIQUE,
  client_email            text NOT NULL,
  company_name            text,
  address                 text,
  pic_name                text,
  pic_phone               text,
  billing_email           text,
  tax_id                  text,
  payment_method_notes    text,
  brand_preferences       jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- ── customer_notification_reads ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.customer_notification_reads (
  id                  serial PRIMARY KEY,
  email_hash          text NOT NULL,
  notification_key    text NOT NULL,
  read_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_notification_reads_email_key_uq UNIQUE (email_hash, notification_key)
);

-- ── customer_support_tickets ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.customer_support_tickets (
  id             serial PRIMARY KEY,
  email_hash     text NOT NULL,
  client_email   text NOT NULL,
  client_name    text NOT NULL,
  project_id     text,
  subject        text NOT NULL,
  message        text NOT NULL,
  category       text NOT NULL DEFAULT 'general',
  status         text NOT NULL DEFAULT 'open',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_support_tickets_email_hash_idx
  ON ai_platform.customer_support_tickets (email_hash);

-- ── creative_ai_assets: Brand Asset Library + version history columns ────────

ALTER TABLE ai_platform.creative_ai_assets
  ADD COLUMN IF NOT EXISTS category         text,
  ADD COLUMN IF NOT EXISTS version          integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS parent_asset_id  integer,
  ADD COLUMN IF NOT EXISTS approved_by      text,
  ADD COLUMN IF NOT EXISTS revision_notes   text;

CREATE INDEX IF NOT EXISTS customer_profiles_email_hash_idx
  ON ai_platform.customer_profiles (email_hash);
