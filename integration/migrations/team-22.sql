-- Team 22 — Creative Vendor Ecosystem
-- Migration draft — DOMAIN MAPPING REVIEW (Team 23 Audit Remediation)
-- Status: BLOCKED_PENDING_VENDOR_CANONICAL_MAPPING
--
-- Run AFTER team-04.sql (marketplace_creators must exist).
-- Idempotent: uses IF NOT EXISTS throughout.
-- Additive only: no DROP, no TRUNCATE, no destructive rename.
--
-- DOMAIN MAPPING DECISIONS:
--   REVERTED tables (canonical source → existing platform table):
--     creative_vendors              → marketplace_creators (master)
--     creative_vendor_ratings       → marketplace_ratings (itemType='creative_vendor')
--     creative_vendor_portfolio_items → ai_service_portfolios (existing)
--     creative_vendor_contact_requests → pending architecture review
--       (Options: ai_quotations extension, ai_vendor_inquiries new table,
--        or quotation+discriminator pattern)
--
--   KEPT tables (new concepts, no existing counterpart):
--     creative_vendor_profiles      — extension of marketplace_creators (1:1)
--     creative_vendor_service_areas — geographic/remote coverage
--     creative_vendor_capabilities  — creative capability tags
--     creative_vendor_certifications — vendor verification metadata
--
-- Team 24 integration task:
--   1. Run this SQL against ai_platform schema (search_path=ai_platform,public).
--   2. Mount vendorRouter: app.use('/', vendorRouter) in app.ts
--   3. DO NOT register schema export in lib/db/src/schema/index.ts yet —
--      pending architecture review.
--   4. Assign architecture review for blocked concepts:
--      a. Portfolio: FK column on ai_service_portfolios vs join table
--      b. Contact requests: ai_quotations extension vs ai_vendor_inquiries

SET search_path TO ai_platform, public;

-- ── creative_vendor_profiles ──────────────────────────────────────────────────
--
-- Extension (1:1) of marketplace_creators.
-- Adds physical-vendor-specific metadata: vendor_type, location, lead_time,
-- pricing (display-only), creative moderation.
--
-- FK: creator_id → marketplace_creators(id) UNIQUE ensures 1:1 extension.
-- creative_vendors master table was reverted — identity anchored here to
-- marketplace_creators as the canonical vendor entity.

CREATE TABLE IF NOT EXISTS creative_vendor_profiles (
    id                  SERIAL PRIMARY KEY,

    -- Canonical anchor — 1:1 with marketplace_creators
    creator_id          INTEGER NOT NULL UNIQUE
                            REFERENCES marketplace_creators(id) ON DELETE CASCADE,

    -- Creative service type (17 physical/service vendor categories)
    vendor_type         TEXT NOT NULL,

    -- Contact augmentation (physical vendor specific — not in marketplace_creators)
    whatsapp            TEXT,
    instagram_url       TEXT,

    -- Location (physical vendor dimension)
    city                TEXT,
    province            TEXT,
    country             TEXT NOT NULL DEFAULT 'ID',

    -- Pricing — display-only; NOT connected to procurement, checkout, or RAB
    min_price           INTEGER,
    max_price           INTEGER,
    price_currency      TEXT DEFAULT 'IDR',

    -- Operations / lead time (creative service dimension)
    lead_time_days      INTEGER NOT NULL DEFAULT 7,
    is_available_now    BOOLEAN NOT NULL DEFAULT TRUE,

    -- Creative vendor moderation (separate from marketplace_creators.is_active)
    moderation_status   TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
    moderation_note     TEXT,
    moderated_at        TIMESTAMPTZ,
    is_featured         BOOLEAN NOT NULL DEFAULT FALSE,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── creative_vendor_service_areas ─────────────────────────────────────────────
-- Geographic and remote service coverage.
-- NEW CONCEPT — no existing counterpart.
-- FK: profile_id → creative_vendor_profiles(id)

CREATE TABLE IF NOT EXISTS creative_vendor_service_areas (
    id          SERIAL PRIMARY KEY,
    profile_id  INTEGER NOT NULL
                    REFERENCES creative_vendor_profiles(id) ON DELETE CASCADE,
    province    TEXT NOT NULL,
    city        TEXT,
    is_remote   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── creative_vendor_capabilities ─────────────────────────────────────────────
-- Creative capability tags: material, fashion, interior, tools, proficiency.
-- NEW CONCEPT — no existing counterpart.
-- FK: profile_id → creative_vendor_profiles(id)

CREATE TABLE IF NOT EXISTS creative_vendor_capabilities (
    id                  SERIAL PRIMARY KEY,
    profile_id          INTEGER NOT NULL
                            REFERENCES creative_vendor_profiles(id) ON DELETE CASCADE,
    capability_name     TEXT NOT NULL,     -- e.g. "Logo Design", "Batik Fabric", "3D Render"
    proficiency_level   TEXT NOT NULL DEFAULT 'intermediate',  -- beginner|intermediate|expert
    years_experience    INTEGER,
    tools_json          JSONB DEFAULT '[]',  -- e.g. ["Adobe Illustrator", "Figma"]
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── creative_vendor_certifications ───────────────────────────────────────────
-- Vendor verification metadata: certifications, licences, industry bodies.
-- NEW CONCEPT — no existing counterpart.
-- FK: profile_id → creative_vendor_profiles(id)

CREATE TABLE IF NOT EXISTS creative_vendor_certifications (
    id                  SERIAL PRIMARY KEY,
    profile_id          INTEGER NOT NULL
                            REFERENCES creative_vendor_profiles(id) ON DELETE CASCADE,
    certification_name  TEXT NOT NULL,
    issuer              TEXT,
    issued_at           DATE,
    expires_at          DATE,
    verification_url    TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Profile browse / filter
CREATE INDEX IF NOT EXISTS idx_cvp_moderation
    ON creative_vendor_profiles (moderation_status);

CREATE INDEX IF NOT EXISTS idx_cvp_type_approved
    ON creative_vendor_profiles (vendor_type)
    WHERE moderation_status = 'approved';

CREATE INDEX IF NOT EXISTS idx_cvp_province_approved
    ON creative_vendor_profiles (province)
    WHERE moderation_status = 'approved';

CREATE INDEX IF NOT EXISTS idx_cvp_featured
    ON creative_vendor_profiles (is_featured DESC)
    WHERE moderation_status = 'approved';

CREATE INDEX IF NOT EXISTS idx_cvp_lead_time
    ON creative_vendor_profiles (lead_time_days ASC)
    WHERE moderation_status = 'approved';

CREATE INDEX IF NOT EXISTS idx_cvp_creator
    ON creative_vendor_profiles (creator_id);

-- Child table indexes
CREATE INDEX IF NOT EXISTS idx_cvsa_profile
    ON creative_vendor_service_areas (profile_id);

CREATE INDEX IF NOT EXISTS idx_cvsa_province
    ON creative_vendor_service_areas (province);

CREATE INDEX IF NOT EXISTS idx_cvcap_profile
    ON creative_vendor_capabilities (profile_id);

CREATE INDEX IF NOT EXISTS idx_cvcert_profile
    ON creative_vendor_certifications (profile_id);

-- ── PENDING — blocked tables (not created yet) ────────────────────────────────
--
-- The following tables are BLOCKED pending architecture review:
--
-- 1. creative_vendor_ratings
--    Canonical: marketplace_ratings (itemType='creative_vendor')
--    Action: Architecture review to confirm itemType extension is sufficient
--    or whether a vendor-specific rating table adds value.
--
-- 2. creative_vendor_portfolio_items
--    Canonical: ai_service_portfolios
--    Action: Architecture review:
--      Option A — ADD COLUMN creative_vendor_profile_id INTEGER
--                   REFERENCES creative_vendor_profiles(id)
--                 to ai_service_portfolios (Team 24 task)
--      Option B — CREATE TABLE creative_portfolio_associations
--                   (portfolio_id INTEGER, profile_id INTEGER, PRIMARY KEY (portfolio_id, profile_id))
--
-- 3. creative_vendor_contact_requests
--    Canonical: pending review
--    Action: Architecture review:
--      Option A — Extend ai_quotations with vendor_profile_id + inquiry_type discriminator
--      Option B — CREATE TABLE ai_vendor_inquiries anchored to marketplace_creators(id)
--      Option C — Reuse quotation flow as lightweight inquiry
