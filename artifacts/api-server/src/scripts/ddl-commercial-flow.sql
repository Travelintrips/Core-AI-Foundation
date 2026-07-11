-- DDL: Dual Commercial Flow (Standard fixed_price vs Custom/Enterprise)
-- Additive only. Run once against the Supabase dev/prod database.
-- All tables live in the ai_platform schema.

SET search_path TO ai_platform, public;

-- ── ai_services: service_flow ────────────────────────────────────────────────
-- Defaults to 'custom_project' so every existing service keeps the current
-- (pre-dual-flow) quotation-first behavior until an admin opts a service into
-- 'fixed_price' (Standard, no quotation) or 'enterprise'.

ALTER TABLE ai_platform.ai_services
  ADD COLUMN IF NOT EXISTS service_flow text NOT NULL DEFAULT 'custom_project';

-- ── ai_service_packages: commercial terms for the Standard checkout flow ────

ALTER TABLE ai_platform.ai_service_packages
  ADD COLUMN IF NOT EXISTS payment_policy      text NOT NULL DEFAULT 'full_payment',
  ADD COLUMN IF NOT EXISTS deposit_percentage  integer NOT NULL DEFAULT 50;

-- ── creative_projects: payment tracking ──────────────────────────────────────

ALTER TABLE ai_platform.creative_projects
  ADD COLUMN IF NOT EXISTS payment_policy      text NOT NULL DEFAULT 'full_payment',
  ADD COLUMN IF NOT EXISTS deposit_percentage  integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS payment_status       text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS files_unlocked        boolean NOT NULL DEFAULT false;

-- ── ai_payment_schedule ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.ai_payment_schedule (
  id             serial PRIMARY KEY,
  project_id     integer NOT NULL REFERENCES ai_platform.creative_projects(id) ON DELETE CASCADE,
  payment_type   text NOT NULL DEFAULT 'full_payment',
  percentage     integer,
  amount         numeric(14,2) NOT NULL DEFAULT 0,
  currency       text NOT NULL DEFAULT 'IDR',
  due_date       timestamptz,
  status         text NOT NULL DEFAULT 'pending',
  reference      text,
  verified_by    text,
  paid_at        timestamptz,
  notes          text,
  display_order  integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_payment_schedule_project_id ON ai_platform.ai_payment_schedule(project_id);

-- ── ai_invoices ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.ai_invoices (
  id                    serial PRIMARY KEY,
  invoice_number        text NOT NULL UNIQUE,
  project_id            integer NOT NULL REFERENCES ai_platform.creative_projects(id) ON DELETE CASCADE,
  payment_schedule_id   integer REFERENCES ai_platform.ai_payment_schedule(id) ON DELETE SET NULL,
  invoice_type          text NOT NULL DEFAULT 'final',
  amount                numeric(14,2) NOT NULL DEFAULT 0,
  currency              text NOT NULL DEFAULT 'IDR',
  status                text NOT NULL DEFAULT 'issued',
  line_items_json       jsonb,
  issued_at             timestamptz NOT NULL DEFAULT now(),
  paid_at               timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_invoices_project_id ON ai_platform.ai_invoices(project_id);
