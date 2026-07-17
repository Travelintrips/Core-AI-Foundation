-- ============================================================
-- Team 21 — Creative Marketplace V2
-- Hand-written DDL. Idempotent (IF NOT EXISTS throughout).
-- Run AFTER existing ai_platform schema is in place.
-- Never use drizzle-kit push — hand-write DDL per project convention.
-- ============================================================

-- ── Creator profiles ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.cm2_creator_profiles (
  id              SERIAL PRIMARY KEY,
  creator_code    TEXT NOT NULL UNIQUE,
  display_name    TEXT NOT NULL,
  bio             TEXT,
  avatar_url      TEXT,
  website_url     TEXT,
  social_links    JSONB NOT NULL DEFAULT '{}',
  email           TEXT,
  is_verified     BOOLEAN NOT NULL DEFAULT false,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  total_listings  INTEGER NOT NULL DEFAULT 0,
  total_downloads INTEGER NOT NULL DEFAULT 0,
  avg_rating      NUMERIC(3,2) NOT NULL DEFAULT 0,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cm2_creators_verified_idx
  ON ai_platform.cm2_creator_profiles (is_verified)
  WHERE is_active = true;

-- ── Listings ─────────────────────────────────────────────────────────────────
-- item_type: blueprint|template|pattern|icon|illustration|layout|
--            typography_pairing|palette|interior_material|
--            furniture_reference|fashion_motif|brand_pack

CREATE TABLE IF NOT EXISTS ai_platform.cm2_listings (
  id                 SERIAL PRIMARY KEY,
  listing_code       TEXT NOT NULL UNIQUE,
  item_type          TEXT NOT NULL,
  title              TEXT NOT NULL,
  description        TEXT,
  category           TEXT NOT NULL,
  tags               JSONB NOT NULL DEFAULT '[]',
  creator_id         INTEGER REFERENCES ai_platform.cm2_creator_profiles(id) ON DELETE SET NULL,
  -- licensing
  price_type         TEXT NOT NULL DEFAULT 'free',   -- free | premium
  price_amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency           TEXT NOT NULL DEFAULT 'IDR',
  license_type       TEXT NOT NULL DEFAULT 'standard', -- standard | extended | exclusive
  license_metadata   JSONB NOT NULL DEFAULT '{}',
  -- files (file_url NEVER sent to public endpoints)
  file_url           TEXT,
  preview_urls       JSONB NOT NULL DEFAULT '[]',
  thumbnail_url      TEXT,
  file_size_bytes    BIGINT,
  file_format        TEXT,
  -- moderation
  moderation_state   TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | suspended
  moderation_note    TEXT,
  -- visibility
  is_featured        BOOLEAN NOT NULL DEFAULT false,
  is_active          BOOLEAN NOT NULL DEFAULT true,
  -- stats (denormalised counters)
  downloads_count    INTEGER NOT NULL DEFAULT 0,
  views_count        INTEGER NOT NULL DEFAULT 0,
  favorites_count    INTEGER NOT NULL DEFAULT 0,
  avg_rating         NUMERIC(3,2) NOT NULL DEFAULT 0,
  ratings_count      INTEGER NOT NULL DEFAULT 0,
  metadata           JSONB NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cm2_listings_type_idx
  ON ai_platform.cm2_listings (item_type);
CREATE INDEX IF NOT EXISTS cm2_listings_moderation_idx
  ON ai_platform.cm2_listings (moderation_state);
CREATE INDEX IF NOT EXISTS cm2_listings_featured_idx
  ON ai_platform.cm2_listings (is_featured)
  WHERE is_active = true AND moderation_state = 'approved';
CREATE INDEX IF NOT EXISTS cm2_listings_creator_idx
  ON ai_platform.cm2_listings (creator_id);
CREATE INDEX IF NOT EXISTS cm2_listings_price_type_idx
  ON ai_platform.cm2_listings (price_type, moderation_state);
CREATE INDEX IF NOT EXISTS cm2_listings_created_at_idx
  ON ai_platform.cm2_listings (created_at DESC);

-- ── Favorites ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.cm2_favorites (
  id             SERIAL PRIMARY KEY,
  customer_email TEXT NOT NULL,
  listing_id     INTEGER NOT NULL REFERENCES ai_platform.cm2_listings(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_email, listing_id)
);

CREATE INDEX IF NOT EXISTS cm2_favorites_email_idx
  ON ai_platform.cm2_favorites (customer_email);

-- ── Ratings ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.cm2_ratings (
  id             SERIAL PRIMARY KEY,
  customer_email TEXT NOT NULL,
  listing_id     INTEGER NOT NULL REFERENCES ai_platform.cm2_listings(id) ON DELETE CASCADE,
  rating         INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_email, listing_id)
);

CREATE INDEX IF NOT EXISTS cm2_ratings_listing_idx
  ON ai_platform.cm2_ratings (listing_id);

-- ── Downloads ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.cm2_downloads (
  id             SERIAL PRIMARY KEY,
  customer_email TEXT,           -- nullable for anonymous
  listing_id     INTEGER NOT NULL REFERENCES ai_platform.cm2_listings(id) ON DELETE CASCADE,
  ip_address     TEXT,
  metadata       JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cm2_downloads_listing_idx
  ON ai_platform.cm2_downloads (listing_id);
CREATE INDEX IF NOT EXISTS cm2_downloads_email_idx
  ON ai_platform.cm2_downloads (customer_email)
  WHERE customer_email IS NOT NULL;

-- ── Moderation log ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.cm2_moderation_log (
  id           SERIAL PRIMARY KEY,
  listing_id   INTEGER NOT NULL REFERENCES ai_platform.cm2_listings(id) ON DELETE CASCADE,
  from_state   TEXT NOT NULL,
  to_state     TEXT NOT NULL,
  reason       TEXT,
  admin_note   TEXT,
  performed_by TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cm2_moderation_log_listing_idx
  ON ai_platform.cm2_moderation_log (listing_id);

-- ── Analytics snapshots (daily delta counters) ────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.cm2_analytics_snapshots (
  id               SERIAL PRIMARY KEY,
  listing_id       INTEGER NOT NULL REFERENCES ai_platform.cm2_listings(id) ON DELETE CASCADE,
  snapshot_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  views_delta      INTEGER NOT NULL DEFAULT 0,
  downloads_delta  INTEGER NOT NULL DEFAULT 0,
  favorites_delta  INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (listing_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS cm2_analytics_listing_date_idx
  ON ai_platform.cm2_analytics_snapshots (listing_id, snapshot_date DESC);

-- ── Trigger: keep updated_at current on cm2_listings ─────────────────────────

CREATE OR REPLACE FUNCTION ai_platform.cm2_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'cm2_listings_updated_at'
  ) THEN
    CREATE TRIGGER cm2_listings_updated_at
      BEFORE UPDATE ON ai_platform.cm2_listings
      FOR EACH ROW EXECUTE FUNCTION ai_platform.cm2_set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'cm2_creators_updated_at'
  ) THEN
    CREATE TRIGGER cm2_creators_updated_at
      BEFORE UPDATE ON ai_platform.cm2_creator_profiles
      FOR EACH ROW EXECUTE FUNCTION ai_platform.cm2_set_updated_at();
  END IF;
END $$;
