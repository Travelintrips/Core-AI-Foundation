-- ============================================================================
-- Team 15 — Graphic Design Domain Migration
-- Target: Supabase project, schema: ai_platform
-- Run: psql -c "SET search_path TO ai_platform, public;" < team-15.sql
-- ============================================================================

SET search_path TO ai_platform, public;

-- ── Graphic Design Briefs ─────────────────────────────────────────────────────
-- Stores one row per client brief, one per service per engagement.
-- Replaces the in-memory store in service.ts once this migration runs.

CREATE TABLE IF NOT EXISTS ai_platform.gd_briefs (
  id              TEXT        NOT NULL DEFAULT gen_random_uuid()::TEXT PRIMARY KEY,
  service_code    TEXT        NOT NULL
                    CHECK (service_code IN (
                      'GD-LOGO','GD-BCARD','GD-LTRHEAD','GD-FLYER','GD-POSTER',
                      'GD-BANNER','GD-BROCHURE','GD-SOCIAL','GD-CERT','GD-STATIONERY'
                    )),
  status          TEXT        NOT NULL DEFAULT 'pending_review'
                    CHECK (status IN (
                      'draft','pending_review','approved','in_production',
                      'qc_check','qc_failed','revision_requested','completed','cancelled'
                    )),
  package_tier    TEXT        NOT NULL DEFAULT 'standard'
                    CHECK (package_tier IN ('basic','standard','premium')),
  output_format   TEXT        NOT NULL DEFAULT 'both'
                    CHECK (output_format IN ('digital','print','both')),
  urgency_level   TEXT        NOT NULL DEFAULT 'standard'
                    CHECK (urgency_level IN ('standard','rush','express')),

  -- Client & brand information (denormalised for quick list queries)
  client_name     TEXT        NOT NULL,
  brand_name      TEXT        NOT NULL,
  industry        TEXT        NOT NULL,

  -- Full brief JSON (matches GraphicDesignBrief Zod schema)
  brief_json      JSONB       NOT NULL,

  -- Deliverable manifest JSON (matches DeliverableManifest type)
  manifest_json   JSONB       NOT NULL,

  -- Dispatched job IDs (JSON array of strings)
  job_ids         JSONB       NOT NULL DEFAULT '[]',

  -- QC result (null until first QC run)
  qc_result_json  JSONB,

  -- Status note (last status change reason)
  status_note     TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gd_briefs_service_code
  ON ai_platform.gd_briefs (service_code);

CREATE INDEX IF NOT EXISTS idx_gd_briefs_status
  ON ai_platform.gd_briefs (status);

CREATE INDEX IF NOT EXISTS idx_gd_briefs_package_tier
  ON ai_platform.gd_briefs (package_tier);

CREATE INDEX IF NOT EXISTS idx_gd_briefs_created_at
  ON ai_platform.gd_briefs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gd_briefs_status_service
  ON ai_platform.gd_briefs (status, service_code);

-- ── QC Runs ───────────────────────────────────────────────────────────────────
-- Audit trail of every QC run (briefs can have multiple runs after revisions).

CREATE TABLE IF NOT EXISTS ai_platform.gd_qc_runs (
  id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  brief_id        TEXT        NOT NULL
                    REFERENCES ai_platform.gd_briefs (id) ON DELETE CASCADE,
  qc_score        NUMERIC(5,2) NOT NULL,
  passed          BOOLEAN     NOT NULL,
  failure_count   INTEGER     NOT NULL DEFAULT 0,
  warning_count   INTEGER     NOT NULL DEFAULT 0,
  checks_json     JSONB       NOT NULL,  -- per-check breakdown
  run_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gd_qc_runs_brief_id
  ON ai_platform.gd_qc_runs (brief_id, run_at DESC);

-- ── Catalog registration rows ─────────────────────────────────────────────────
-- Seed graphic-design category and 10 service codes into the shared catalog.
-- Uses INSERT ... ON CONFLICT DO UPDATE (idempotent).

-- 1. Category
INSERT INTO ai_platform.ai_service_categories
  (code, name, description, icon, display_order, status, visibility, commercial_status)
VALUES
  (
    'graphic-design',
    'Graphic Design AI',
    'Professional print and digital design services: logos, cards, letterheads, flyers, posters, banners, brochures, social media kits, certificates, and stationery — all AI-generated with human quality standards.',
    'palette',
    16,
    'active',
    'public',
    'commercial_ready'
  )
ON CONFLICT (code) DO UPDATE SET
  name               = EXCLUDED.name,
  description        = EXCLUDED.description,
  icon               = EXCLUDED.icon,
  display_order      = EXCLUDED.display_order,
  status             = EXCLUDED.status,
  visibility         = EXCLUDED.visibility,
  commercial_status  = EXCLUDED.commercial_status,
  updated_at         = NOW();

-- 2. Services (10)
DO $$
DECLARE
  cat_id INTEGER;
BEGIN
  SELECT id INTO cat_id FROM ai_platform.ai_service_categories WHERE code = 'graphic-design';

  -- GD-LOGO
  INSERT INTO ai_platform.ai_services
    (category_id, service_code, service_name, short_description, service_type, service_flow,
     pricing_model, starting_price, currency, estimated_delivery, human_review, ai_only,
     department, deliverables, status)
  VALUES (cat_id, 'GD-LOGO', 'Logo Concept',
    'AI-generated professional logo concepts: wordmark, lettermark, combination, emblem, or mascot styles.',
    'project', 'custom_project', 'one_time', 1500000, 'IDR', '3-7 business days',
    false, true, 'graphic-design',
    '["Primary logo (SVG/PDF/PNG)","Dark variant","Monochrome variant","Horizontal layout","Favicon set"]'::jsonb,
    'active')
  ON CONFLICT (service_code) DO UPDATE SET service_name = EXCLUDED.service_name, updated_at = NOW();

  -- GD-BCARD
  INSERT INTO ai_platform.ai_services
    (category_id, service_code, service_name, short_description, service_type, service_flow,
     pricing_model, starting_price, currency, estimated_delivery, human_review, ai_only,
     department, deliverables, status)
  VALUES (cat_id, 'GD-BCARD', 'Business Card',
    'Print-ready business card design with full bleed, CMYK color profile, and all standard sizes.',
    'project', 'fixed_price', 'one_time', 300000, 'IDR', '2-4 business days',
    false, true, 'graphic-design',
    '["Print-ready PDF (CMYK + bleed)","PNG preview","Digital PDF (screen)"]'::jsonb,
    'active')
  ON CONFLICT (service_code) DO UPDATE SET service_name = EXCLUDED.service_name, updated_at = NOW();

  -- GD-LTRHEAD
  INSERT INTO ai_platform.ai_services
    (category_id, service_code, service_name, short_description, service_type, service_flow,
     pricing_model, starting_price, currency, estimated_delivery, human_review, ai_only,
     department, deliverables, status)
  VALUES (cat_id, 'GD-LTRHEAD', 'Letterhead',
    'Professional A4/Letter letterhead with optional envelope, complimentary slip, and second-page variant.',
    'project', 'fixed_price', 'one_time', 450000, 'IDR', '2-3 business days',
    false, true, 'graphic-design',
    '["Letterhead PDF (print-ready)","Digital PDF (screen)","PNG preview"]'::jsonb,
    'active')
  ON CONFLICT (service_code) DO UPDATE SET service_name = EXCLUDED.service_name, updated_at = NOW();

  -- GD-FLYER
  INSERT INTO ai_platform.ai_services
    (category_id, service_code, service_name, short_description, service_type, service_flow,
     pricing_model, starting_price, currency, estimated_delivery, human_review, ai_only,
     department, deliverables, status)
  VALUES (cat_id, 'GD-FLYER', 'Flyer',
    'Eye-catching A4/A5/A6 flyers for events, promotions, menus, and product launches. Print-ready + digital.',
    'project', 'fixed_price', 'one_time', 300000, 'IDR', '1-3 business days',
    false, true, 'graphic-design',
    '["Print-ready PDF","PNG preview","JPG social share"]'::jsonb,
    'active')
  ON CONFLICT (service_code) DO UPDATE SET service_name = EXCLUDED.service_name, updated_at = NOW();

  -- GD-POSTER
  INSERT INTO ai_platform.ai_services
    (category_id, service_code, service_name, short_description, service_type, service_flow,
     pricing_model, starting_price, currency, estimated_delivery, human_review, ai_only,
     department, deliverables, status)
  VALUES (cat_id, 'GD-POSTER', 'Poster',
    'Large-format A0–A4 posters at 300dpi. Events, advertising, informational, and artistic styles.',
    'project', 'fixed_price', 'one_time', 450000, 'IDR', '2-5 business days',
    false, true, 'graphic-design',
    '["Print-ready PDF","PNG preview","JPG web share","Digital PDF"]'::jsonb,
    'active')
  ON CONFLICT (service_code) DO UPDATE SET service_name = EXCLUDED.service_name, updated_at = NOW();

  -- GD-BANNER
  INSERT INTO ai_platform.ai_services
    (category_id, service_code, service_name, short_description, service_type, service_flow,
     pricing_model, starting_price, currency, estimated_delivery, human_review, ai_only,
     department, deliverables, status)
  VALUES (cat_id, 'GD-BANNER', 'Banner',
    'Roll-up, X-banner, backdrop, digital leaderboard, and billboard banners. Indoor and outdoor specs.',
    'project', 'custom_project', 'one_time', 600000, 'IDR', '2-4 business days',
    false, true, 'graphic-design',
    '["Print-ready PDF","PNG preview","Digital JPG"]'::jsonb,
    'active')
  ON CONFLICT (service_code) DO UPDATE SET service_name = EXCLUDED.service_name, updated_at = NOW();

  -- GD-BROCHURE
  INSERT INTO ai_platform.ai_services
    (category_id, service_code, service_name, short_description, service_type, service_flow,
     pricing_model, starting_price, currency, estimated_delivery, human_review, ai_only,
     department, deliverables, status)
  VALUES (cat_id, 'GD-BROCHURE', 'Brochure',
    'Trifold, bifold, gatefold, and accordion brochures. A4/A5/DL sizes. Company profile to product catalogs.',
    'project', 'custom_project', 'one_time', 900000, 'IDR', '3-5 business days',
    false, true, 'graphic-design',
    '["Print-ready PDF (CMYK + bleed)","Cover PNG preview","Digital flat PDF"]'::jsonb,
    'active')
  ON CONFLICT (service_code) DO UPDATE SET service_name = EXCLUDED.service_name, updated_at = NOW();

  -- GD-SOCIAL
  INSERT INTO ai_platform.ai_services
    (category_id, service_code, service_name, short_description, service_type, service_flow,
     pricing_model, starting_price, currency, estimated_delivery, human_review, ai_only,
     department, deliverables, status)
  VALUES (cat_id, 'GD-SOCIAL', 'Social Media Kit',
    'Branded social media design sets for Instagram, Facebook, LinkedIn, Twitter, YouTube, and TikTok.',
    'project', 'custom_project', 'one_time', 900000, 'IDR', '2-4 business days',
    false, true, 'graphic-design',
    '["Platform-specific PNGs (all sizes)","Story variants","Highlight icons","ZIP archive"]'::jsonb,
    'active')
  ON CONFLICT (service_code) DO UPDATE SET service_name = EXCLUDED.service_name, updated_at = NOW();

  -- GD-CERT
  INSERT INTO ai_platform.ai_services
    (category_id, service_code, service_name, short_description, service_type, service_flow,
     pricing_model, starting_price, currency, estimated_delivery, human_review, ai_only,
     department, deliverables, status)
  VALUES (cat_id, 'GD-CERT', 'Certificate',
    'Achievement, completion, and appreciation certificates with signatures, seals, and optional security features.',
    'project', 'fixed_price', 'one_time', 300000, 'IDR', '1-3 business days',
    false, true, 'graphic-design',
    '["Print-ready PDF","Digital PDF","PNG preview","JPG social share"]'::jsonb,
    'active')
  ON CONFLICT (service_code) DO UPDATE SET service_name = EXCLUDED.service_name, updated_at = NOW();

  -- GD-STATIONERY
  INSERT INTO ai_platform.ai_services
    (category_id, service_code, service_name, short_description, service_type, service_flow,
     pricing_model, starting_price, currency, estimated_delivery, human_review, ai_only,
     department, deliverables, status)
  VALUES (cat_id, 'GD-STATIONERY', 'Stationery Suite',
    'Complete brand stationery: letterhead, envelope, business card, notepad, folder, ID card — fully consistent.',
    'project', 'custom_project', 'one_time', 1800000, 'IDR', '4-7 business days',
    false, true, 'graphic-design',
    '["All stationery item PDFs (print-ready)","PNG previews","ZIP archive"]'::jsonb,
    'active')
  ON CONFLICT (service_code) DO UPDATE SET service_name = EXCLUDED.service_name, updated_at = NOW();

END $$;

-- ── Preflight check ───────────────────────────────────────────────────────────
-- Run this query after migration to verify everything landed:
--
--   SELECT service_code, service_name, status
--   FROM ai_platform.ai_services
--   WHERE service_code LIKE 'GD-%'
--   ORDER BY service_code;
--
--   SELECT COUNT(*) FROM ai_platform.gd_briefs;   -- should be 0 initially
--   SELECT COUNT(*) FROM ai_platform.gd_qc_runs;  -- should be 0 initially
