-- Sprint P2.5 — Commercial Conversion Layer
-- Hand-written DDL (do NOT use drizzle-kit push for ai_platform schema)
-- Run against Supabase dev database

SET search_path TO ai_platform, public;

-- ─── Sales Funnel Events ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.sales_funnel_events (
  id              SERIAL PRIMARY KEY,
  visitor_id      TEXT,
  customer_id     INTEGER,
  session_id      TEXT,
  event_type      TEXT NOT NULL,
  service_id      INTEGER,
  portfolio_id    INTEGER,
  project_id      TEXT,
  package_id      INTEGER,
  campaign_id     TEXT,
  utm_source      TEXT,
  utm_medium      TEXT,
  utm_campaign    TEXT,
  device          TEXT,
  country         TEXT,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sfe_event_type ON ai_platform.sales_funnel_events(event_type);
CREATE INDEX IF NOT EXISTS idx_sfe_visitor    ON ai_platform.sales_funnel_events(visitor_id);
CREATE INDEX IF NOT EXISTS idx_sfe_customer   ON ai_platform.sales_funnel_events(customer_id);
CREATE INDEX IF NOT EXISTS idx_sfe_created    ON ai_platform.sales_funnel_events(created_at DESC);

-- ─── Promotions ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.ai_promotions (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  discount_type   TEXT NOT NULL CHECK (discount_type IN ('percentage','fixed','free_revision','free_source_file','free_consultation','bundle')),
  discount_value  INTEGER,
  benefit_label   TEXT,
  service_id      INTEGER,
  package_id      INTEGER,
  industry        TEXT,
  start_date      TIMESTAMPTZ,
  end_date        TIMESTAMPTZ,
  usage_limit     INTEGER,
  usage_count     INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','expired')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Coupons ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.ai_coupons (
  id                SERIAL PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,
  type              TEXT NOT NULL CHECK (type IN ('percentage','fixed')),
  value             INTEGER NOT NULL,
  minimum_order     INTEGER,
  maximum_discount  INTEGER,
  start_date        TIMESTAMPTZ,
  end_date          TIMESTAMPTZ,
  usage_limit       INTEGER,
  usage_per_customer INTEGER NOT NULL DEFAULT 1,
  usage_count       INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','expired')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_platform.ai_coupon_usages (
  id                  SERIAL PRIMARY KEY,
  coupon_id           INTEGER NOT NULL REFERENCES ai_platform.ai_coupons(id) ON DELETE CASCADE,
  customer_profile_id INTEGER,
  service_request_id  INTEGER,
  discount_amount     INTEGER NOT NULL,
  used_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cu_coupon   ON ai_platform.ai_coupon_usages(coupon_id);
CREATE INDEX IF NOT EXISTS idx_cu_customer ON ai_platform.ai_coupon_usages(customer_profile_id);

-- ─── Referrals ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.ai_referrals (
  id                  SERIAL PRIMARY KEY,
  referrer_profile_id INTEGER NOT NULL,
  referee_profile_id  INTEGER,
  referral_code       TEXT NOT NULL UNIQUE,
  referral_link       TEXT,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','converted','rewarded')),
  reward_type         TEXT CHECK (reward_type IN ('cash','discount','credit')),
  reward_amount       INTEGER,
  reward_status       TEXT DEFAULT 'pending' CHECK (reward_status IN ('pending','paid')),
  converted_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ref_referrer ON ai_platform.ai_referrals(referrer_profile_id);
CREATE INDEX IF NOT EXISTS idx_ref_code     ON ai_platform.ai_referrals(referral_code);

-- ─── Affiliates ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.ai_affiliates (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL,
  email               TEXT NOT NULL UNIQUE,
  affiliate_code      TEXT NOT NULL UNIQUE,
  commission_rate     INTEGER NOT NULL DEFAULT 10,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','pending')),
  total_clicks        INTEGER NOT NULL DEFAULT 0,
  total_conversions   INTEGER NOT NULL DEFAULT 0,
  total_revenue       INTEGER NOT NULL DEFAULT 0,
  total_commission    INTEGER NOT NULL DEFAULT 0,
  pending_commission  INTEGER NOT NULL DEFAULT 0,
  paid_commission     INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_platform.ai_affiliate_clicks (
  id            SERIAL PRIMARY KEY,
  affiliate_id  INTEGER NOT NULL REFERENCES ai_platform.ai_affiliates(id) ON DELETE CASCADE,
  visitor_id    TEXT,
  session_id    TEXT,
  landing_page  TEXT,
  device        TEXT,
  country       TEXT,
  converted_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ac_affiliate ON ai_platform.ai_affiliate_clicks(affiliate_id);

CREATE TABLE IF NOT EXISTS ai_platform.ai_affiliate_conversions (
  id                  SERIAL PRIMARY KEY,
  affiliate_id        INTEGER NOT NULL REFERENCES ai_platform.ai_affiliates(id) ON DELETE CASCADE,
  click_id            INTEGER REFERENCES ai_platform.ai_affiliate_clicks(id),
  service_request_id  INTEGER,
  order_amount        INTEGER NOT NULL,
  commission_amount   INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aconv_affiliate ON ai_platform.ai_affiliate_conversions(affiliate_id);

-- ─── Customer Health Scores ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.ai_customer_health_scores (
  id                    SERIAL PRIMARY KEY,
  customer_profile_id   INTEGER NOT NULL UNIQUE,
  payment_score         INTEGER NOT NULL DEFAULT 0,
  activity_score        INTEGER NOT NULL DEFAULT 0,
  repeat_order_score    INTEGER NOT NULL DEFAULT 0,
  review_score          INTEGER NOT NULL DEFAULT 0,
  response_time_score   INTEGER NOT NULL DEFAULT 0,
  overall_score         INTEGER NOT NULL DEFAULT 0,
  health_status         TEXT NOT NULL DEFAULT 'potential' CHECK (health_status IN ('healthy','potential','at_risk','lost')),
  last_calculated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── A/B Tests ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.ai_ab_tests (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL,
  description         TEXT,
  test_type           TEXT NOT NULL CHECK (test_type IN ('package','promotion','cta')),
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed')),
  start_date          TIMESTAMPTZ,
  end_date            TIMESTAMPTZ,
  winner_variant_id   INTEGER,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_platform.ai_ab_variants (
  id            SERIAL PRIMARY KEY,
  test_id       INTEGER NOT NULL REFERENCES ai_platform.ai_ab_tests(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  label         TEXT,
  impressions   INTEGER NOT NULL DEFAULT 0,
  clicks        INTEGER NOT NULL DEFAULT 0,
  checkouts     INTEGER NOT NULL DEFAULT 0,
  conversions   INTEGER NOT NULL DEFAULT 0,
  revenue       INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_abv_test ON ai_platform.ai_ab_variants(test_id);
