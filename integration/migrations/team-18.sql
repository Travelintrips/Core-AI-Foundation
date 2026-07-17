-- Team 18: Fashion & Apparel Design — Database Migration
-- Schema: ai_platform
-- Tables: fashion_design_orders, fashion_design_blueprints
-- Run against your Supabase dev/prod database.
--
-- IMPORTANT: This file is a DRAFT — do NOT apply directly.
-- Team 24 controls migration execution via controlled migration process.
--
-- P1 FIX: updated_at trigger uses domain-unique function name
-- `ai_platform.fashion_design_set_updated_at()` instead of the generic
-- `ai_platform.set_updated_at()` which would override shared DB functions.

SET search_path = ai_platform, public;

-- ── fashion_design_orders ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_platform.fashion_design_orders (
    id                  SERIAL PRIMARY KEY,

    -- Customer identity
    customer_name       TEXT        NOT NULL,
    customer_email      TEXT        NOT NULL,
    order_name          TEXT        NOT NULL,
    description         TEXT,

    -- Service configuration
    service_type        TEXT        NOT NULL CHECK (service_type IN (
                            't-shirt', 'jersey', 'hoodie', 'uniform',
                            'jacket', 'dress', 'batik-inspired', 'merchandise'
                        )),
    quantity            INTEGER     NOT NULL DEFAULT 1 CHECK (quantity >= 1),

    -- Status flow: draft → blueprint_ready → generating → review → approved → delivered
    -- also: trademark_flagged, cancelled
    status              TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN (
                            'draft', 'blueprint_ready', 'generating',
                            'review', 'approved', 'delivered',
                            'trademark_flagged', 'cancelled'
                        )),

    -- Trademark safety
    trademark_safe      BOOLEAN     NOT NULL DEFAULT TRUE,
    trademark_notes     TEXT,

    -- Design data (JSONB)
    colorways           JSONB       NOT NULL DEFAULT '[]',    -- array of hex strings
    motif_config        JSONB,                                 -- { name, repeatPattern, scale, angle }
    composition_json    JSONB,                                 -- editable re-import format
    outputs             JSONB       NOT NULL DEFAULT '{}',     -- generated output URLs/blobs by type

    -- Admin
    admin_notes         TEXT,

    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── fashion_design_blueprints ─────────────────────────────────────────────────
-- One blueprint per order; panel-by-panel placement specification.
CREATE TABLE IF NOT EXISTS ai_platform.fashion_design_blueprints (
    id                  SERIAL PRIMARY KEY,
    order_id            INTEGER     NOT NULL REFERENCES ai_platform.fashion_design_orders(id) ON DELETE CASCADE,

    -- Panel configs keyed by panel name (front/back/sleeves/collar/pocket/logo-area/sponsor/name/number/garment-panels)
    -- Each: { enabled: bool, content: string, position: {x, y}, size: {w, h}, color: string }
    panels              JSONB       NOT NULL DEFAULT '{}',

    -- Placement specification document
    placement_spec      JSONB,

    -- Panel size constraints (min/max for each panel)
    panel_constraints   JSONB,

    -- Logo placement: { logoUrl, panel, x, y, w, h, locked }
    logo_placement      JSONB,

    -- Jersey number/name fields
    number_value        TEXT,         -- e.g. "10", must be 0–99
    name_value          TEXT,         -- e.g. "SURYANTO", max 50 chars
    number_font         TEXT,
    number_color        TEXT,

    -- Sponsor list: [{ name, logoUrl, panel, position }]
    sponsors            JSONB       NOT NULL DEFAULT '[]',

    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One blueprint per order
    CONSTRAINT fashion_design_blueprints_order_id_unique UNIQUE (order_id)
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_fashion_design_orders_status
    ON ai_platform.fashion_design_orders (status);

CREATE INDEX IF NOT EXISTS idx_fashion_design_orders_service_type
    ON ai_platform.fashion_design_orders (service_type);

CREATE INDEX IF NOT EXISTS idx_fashion_design_orders_customer_email
    ON ai_platform.fashion_design_orders (customer_email);

CREATE INDEX IF NOT EXISTS idx_fashion_design_orders_created_at
    ON ai_platform.fashion_design_orders (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fashion_design_blueprints_order_id
    ON ai_platform.fashion_design_blueprints (order_id);

-- ── updated_at trigger — DOMAIN-UNIQUE function name ─────────────────────────
-- P1 FIX: Named `fashion_design_set_updated_at` (not the generic `set_updated_at`)
-- to avoid overriding any shared DB function used by other teams.
-- Does NOT drop triggers owned by other domains.
CREATE OR REPLACE FUNCTION ai_platform.fashion_design_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_fashion_design_orders_updated_at
    ON ai_platform.fashion_design_orders;
CREATE TRIGGER trg_fashion_design_orders_updated_at
    BEFORE UPDATE ON ai_platform.fashion_design_orders
    FOR EACH ROW EXECUTE FUNCTION ai_platform.fashion_design_set_updated_at();

DROP TRIGGER IF EXISTS trg_fashion_design_blueprints_updated_at
    ON ai_platform.fashion_design_blueprints;
CREATE TRIGGER trg_fashion_design_blueprints_updated_at
    BEFORE UPDATE ON ai_platform.fashion_design_blueprints
    FOR EACH ROW EXECUTE FUNCTION ai_platform.fashion_design_set_updated_at();

-- ── Comments ──────────────────────────────────────────────────────────────────
COMMENT ON TABLE ai_platform.fashion_design_orders IS
    'Team 18 — Fashion & Apparel Design orders. Tracks apparel design requests from submission to delivery.';

COMMENT ON TABLE ai_platform.fashion_design_blueprints IS
    'Team 18 — Panel-by-panel blueprint specifications for fashion design orders.';

COMMENT ON COLUMN ai_platform.fashion_design_orders.trademark_safe IS
    'FALSE if any design field references a known trademarked brand or motif. Orders flagged here cannot be approved.';

COMMENT ON COLUMN ai_platform.fashion_design_orders.composition_json IS
    'Editable JSON output for re-import into design tools. NOT a production pattern — requires size spec and technical review.';

COMMENT ON FUNCTION ai_platform.fashion_design_set_updated_at() IS
    'Team 18 domain-local updated_at trigger. Deliberately named with domain prefix to avoid overriding shared set_updated_at functions.';
