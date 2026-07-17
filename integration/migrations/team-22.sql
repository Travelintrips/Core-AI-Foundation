-- Team 22 — Creative Vendor Ecosystem
-- Migration draft: all additive DDL, safe to run on live DB.
-- Run AFTER team-04.sql (no FK dependency on team-04 tables).
-- Idempotent: uses IF NOT EXISTS throughout.
--
-- Team 24 integration task:
--   1. Run this SQL against the ai_platform schema (search_path=ai_platform,public).
--   2. Add `export * from "./creative-vendors";` to lib/db/src/schema/index.ts
--   3. Copy artifacts/api-server/src/domains/creative-vendors/schema.ts
--      to lib/db/src/schema/creative-vendors.ts for shared consumption.

SET search_path TO ai_platform, public;

-- ── creative_vendors ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS creative_vendors (
    id                      SERIAL PRIMARY KEY,
    vendor_code             TEXT NOT NULL UNIQUE,
    display_name            TEXT NOT NULL,
    brand_name              TEXT,
    vendor_type             TEXT NOT NULL,
    description             TEXT,
    short_bio               TEXT,
    logo_url                TEXT,
    cover_url               TEXT,
    gallery_json            JSONB DEFAULT '[]',

    -- Contact (redacted in public DTO)
    whatsapp                TEXT,
    email                   TEXT,
    website_url             TEXT,
    instagram_url           TEXT,

    -- Location
    city                    TEXT,
    province                TEXT,
    country                 TEXT NOT NULL DEFAULT 'ID',

    -- Pricing (optional, display-only — NOT for procurement/RAB)
    min_price               INTEGER,
    max_price               INTEGER,
    price_currency          TEXT DEFAULT 'IDR',

    -- Operations
    lead_time_days          INTEGER NOT NULL DEFAULT 7,
    is_available_now        BOOLEAN NOT NULL DEFAULT TRUE,

    -- Moderation
    status                  TEXT NOT NULL DEFAULT 'active',
    moderation_status       TEXT NOT NULL DEFAULT 'pending',
    moderation_note         TEXT,
    moderated_at            TIMESTAMPTZ,

    -- Stats
    is_verified             BOOLEAN NOT NULL DEFAULT FALSE,
    is_featured             BOOLEAN NOT NULL DEFAULT FALSE,
    total_ratings           INTEGER NOT NULL DEFAULT 0,
    avg_rating              NUMERIC(3, 2) NOT NULL DEFAULT 0,
    total_contact_requests  INTEGER NOT NULL DEFAULT 0,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── creative_vendor_service_areas ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS creative_vendor_service_areas (
    id          SERIAL PRIMARY KEY,
    vendor_id   INTEGER NOT NULL REFERENCES creative_vendors(id) ON DELETE CASCADE,
    province    TEXT NOT NULL,
    city        TEXT,
    is_remote   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── creative_vendor_capabilities ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS creative_vendor_capabilities (
    id                  SERIAL PRIMARY KEY,
    vendor_id           INTEGER NOT NULL REFERENCES creative_vendors(id) ON DELETE CASCADE,
    capability_name     TEXT NOT NULL,
    proficiency_level   TEXT NOT NULL DEFAULT 'intermediate',
    years_experience    INTEGER,
    tools_json          JSONB DEFAULT '[]',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── creative_vendor_certifications ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS creative_vendor_certifications (
    id                  SERIAL PRIMARY KEY,
    vendor_id           INTEGER NOT NULL REFERENCES creative_vendors(id) ON DELETE CASCADE,
    certification_name  TEXT NOT NULL,
    issuer              TEXT,
    issued_at           DATE,
    expires_at          DATE,
    verification_url    TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── creative_vendor_portfolio_items ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS creative_vendor_portfolio_items (
    id                      SERIAL PRIMARY KEY,
    vendor_id               INTEGER NOT NULL REFERENCES creative_vendors(id) ON DELETE CASCADE,
    title                   TEXT NOT NULL,
    description             TEXT,
    category                TEXT,
    cover_image_url         TEXT,
    gallery_json            JSONB DEFAULT '[]',
    client_industry         TEXT,
    project_duration_days   INTEGER,
    tags_json               JSONB DEFAULT '[]',

    -- Moderation
    moderation_status       TEXT NOT NULL DEFAULT 'pending',
    moderation_note         TEXT,
    moderated_at            TIMESTAMPTZ,

    is_featured             BOOLEAN NOT NULL DEFAULT FALSE,
    display_order           INTEGER NOT NULL DEFAULT 0,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── creative_vendor_ratings ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS creative_vendor_ratings (
    id                  SERIAL PRIMARY KEY,
    vendor_id           INTEGER NOT NULL REFERENCES creative_vendors(id) ON DELETE CASCADE,
    client_email_hash   TEXT NOT NULL,
    rating              INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    review              TEXT,
    project_context     TEXT,
    moderation_status   TEXT NOT NULL DEFAULT 'pending',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── creative_vendor_contact_requests ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS creative_vendor_contact_requests (
    id                      SERIAL PRIMARY KEY,
    vendor_id               INTEGER NOT NULL REFERENCES creative_vendors(id) ON DELETE CASCADE,
    requester_email_hash    TEXT NOT NULL,
    requester_name          TEXT,
    project_description     TEXT NOT NULL,
    budget_range            TEXT,
    preferred_start_date    DATE,
    status                  TEXT NOT NULL DEFAULT 'pending',
    vendor_response         TEXT,
    responded_at            TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
-- Performance indexes for common query patterns

CREATE INDEX IF NOT EXISTS idx_creative_vendors_moderation
    ON creative_vendors (moderation_status, status);

CREATE INDEX IF NOT EXISTS idx_creative_vendors_type
    ON creative_vendors (vendor_type)
    WHERE moderation_status = 'approved' AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_creative_vendors_province
    ON creative_vendors (province)
    WHERE moderation_status = 'approved' AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_creative_vendors_rating
    ON creative_vendors (avg_rating DESC)
    WHERE moderation_status = 'approved' AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_creative_vendors_featured
    ON creative_vendors (is_featured DESC, avg_rating DESC)
    WHERE moderation_status = 'approved' AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_creative_vendors_lead_time
    ON creative_vendors (lead_time_days ASC)
    WHERE moderation_status = 'approved' AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_vendor_service_areas_vendor
    ON creative_vendor_service_areas (vendor_id);

CREATE INDEX IF NOT EXISTS idx_vendor_service_areas_province
    ON creative_vendor_service_areas (province);

CREATE INDEX IF NOT EXISTS idx_vendor_capabilities_vendor
    ON creative_vendor_capabilities (vendor_id);

CREATE INDEX IF NOT EXISTS idx_vendor_portfolio_vendor_status
    ON creative_vendor_portfolio_items (vendor_id, moderation_status);

CREATE INDEX IF NOT EXISTS idx_vendor_ratings_vendor_status
    ON creative_vendor_ratings (vendor_id, moderation_status);

CREATE INDEX IF NOT EXISTS idx_vendor_contact_requests_vendor
    ON creative_vendor_contact_requests (vendor_id, status);

CREATE INDEX IF NOT EXISTS idx_vendor_contact_requests_requester
    ON creative_vendor_contact_requests (requester_email_hash);

-- GIN index for JSONB tag search
CREATE INDEX IF NOT EXISTS idx_vendor_portfolio_tags_gin
    ON creative_vendor_portfolio_items USING GIN (tags_json);
