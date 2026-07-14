-- ============================================================
-- P7 Internal RBAC Migration — Customer/Internal Portal Separation
-- Target schema: ai_platform
-- ============================================================
-- ADDITIVE ONLY. No DROP, no TRUNCATE, no data overwrite.
-- Run preflight.sql first. Then apply this file.
-- ============================================================

SET search_path TO ai_platform, public;

-- ── 1. internal_users ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_platform.internal_users (
    id                    SERIAL PRIMARY KEY,
    email                 TEXT NOT NULL,
    password_hash         TEXT NOT NULL,
    role                  TEXT NOT NULL DEFAULT 'internal_staff',
    account_type          TEXT NOT NULL DEFAULT 'internal',
    status                TEXT NOT NULL DEFAULT 'active',
    must_change_password  BOOLEAN NOT NULL DEFAULT true,
    password_changed_at   TIMESTAMPTZ,
    last_login_at         TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_internal_users_email UNIQUE (email),
    CONSTRAINT chk_internal_users_role CHECK (role IN ('owner','admin','manager','internal_staff')),
    CONSTRAINT chk_internal_users_status CHECK (status IN ('active','suspended')),
    CONSTRAINT chk_internal_users_account_type CHECK (account_type = 'internal')
);

CREATE INDEX IF NOT EXISTS idx_internal_users_email ON ai_platform.internal_users (email);
CREATE INDEX IF NOT EXISTS idx_internal_users_role ON ai_platform.internal_users (role);

COMMENT ON TABLE ai_platform.internal_users IS 'Company staff accounts for the Internal AI Portal. Never confused with customer_profiles (token-based, no password).';
COMMENT ON COLUMN ai_platform.internal_users.password_hash IS 'bcrypt hash only. Never store or log plaintext passwords.';

-- ── 2. ai_service_categories — visibility / commercial status ──────────────
ALTER TABLE ai_platform.ai_service_categories
    ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'internal';

ALTER TABLE ai_platform.ai_service_categories
    ADD COLUMN IF NOT EXISTS commercial_status TEXT NOT NULL DEFAULT 'internal_only';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_service_categories_visibility'
    ) THEN
        ALTER TABLE ai_platform.ai_service_categories
            ADD CONSTRAINT chk_ai_service_categories_visibility
            CHECK (visibility IN ('public','internal','disabled'));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_service_categories_commercial_status'
    ) THEN
        ALTER TABLE ai_platform.ai_service_categories
            ADD CONSTRAINT chk_ai_service_categories_commercial_status
            CHECK (commercial_status IN ('commercial_ready','internal_only','beta','disabled'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ai_service_categories_visibility ON ai_platform.ai_service_categories (visibility);

-- Only Creative AI is customer-facing today. Every other existing category
-- keeps the column defaults (internal / internal_only) applied automatically
-- by ADD COLUMN above, so this UPDATE only needs to flip Creative AI.
UPDATE ai_platform.ai_service_categories
   SET visibility = 'public', commercial_status = 'commercial_ready'
 WHERE code = 'creative';

COMMENT ON COLUMN ai_platform.ai_service_categories.visibility IS 'public = shown to customers; internal = company-only; disabled = hidden everywhere.';
COMMENT ON COLUMN ai_platform.ai_service_categories.commercial_status IS 'commercial_ready = safe to sell to customers today; internal_only = not yet customer-ready.';
