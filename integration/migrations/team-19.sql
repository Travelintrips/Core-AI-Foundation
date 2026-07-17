-- ============================================================================
-- TEAM 19 — Packaging Design Domain
-- Branch: feature/19-packaging-design
-- ============================================================================
-- Run against the ai_platform schema on Supabase (dev + prod).
-- All tables live in the ai_platform schema; search_path is set at connection
-- level in lib/db/src/index.ts ("options": "-c search_path=ai_platform,public").
-- ============================================================================

-- ── packaging_design_orders ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.packaging_design_orders (
  id                        SERIAL PRIMARY KEY,
  order_id                  TEXT        NOT NULL UNIQUE,  -- UUID, customer-facing

  -- Service type
  service_type              TEXT        NOT NULL,  -- box | pouch | bottle_label | jar_label | cup | sleeve | food_packaging | cosmetic_packaging

  -- Customer info
  customer_name             TEXT        NOT NULL,
  customer_email            TEXT        NOT NULL,
  customer_phone            TEXT,
  company_name              TEXT,

  -- Product / brand
  brand_name                TEXT        NOT NULL,
  product_name              TEXT        NOT NULL,
  product_category          TEXT,        -- food | beverage | cosmetic | pharma | industrial | other
  market_target             TEXT,
  quantity                  INTEGER     NOT NULL DEFAULT 1,

  -- Panel layout (array: front | back | side | top | bottom)
  panels_required           JSONB       NOT NULL DEFAULT '[]',

  -- Technical dimensions
  width_mm                  NUMERIC(8,2),
  height_mm                 NUMERIC(8,2),
  depth_mm                  NUMERIC(8,2),
  bleed_mm                  NUMERIC(6,2) NOT NULL DEFAULT 3,
  safe_area_mm              NUMERIC(6,2) NOT NULL DEFAULT 5,

  -- Design requirements
  color_mode                TEXT        NOT NULL DEFAULT 'cmyk',  -- cmyk | pantone | rgb
  finish_type               TEXT,        -- matte | gloss | soft_touch | uv_spot | foil | none
  material_type             TEXT,        -- kraft | plastic | glass | aluminium | cardboard | other
  print_sides               INTEGER     NOT NULL DEFAULT 1,

  -- Zones & mandatory blocks
  has_barcode_zone          BOOLEAN     NOT NULL DEFAULT FALSE,
  barcode_type              TEXT,        -- ean13 | qr | code128 | upc | datamatrix
  has_ingredients_block     BOOLEAN     NOT NULL DEFAULT FALSE,
  has_legal_block           BOOLEAN     NOT NULL DEFAULT FALSE,
  has_logo_zone             BOOLEAN     NOT NULL DEFAULT TRUE,
  has_product_image_zone    BOOLEAN     NOT NULL DEFAULT FALSE,
  has_nutrition_facts       BOOLEAN     NOT NULL DEFAULT FALSE,
  has_halal_certification   BOOLEAN     NOT NULL DEFAULT FALSE,
  has_sni_badge             BOOLEAN     NOT NULL DEFAULT FALSE,
  has_bpom_number           BOOLEAN     NOT NULL DEFAULT FALSE,

  -- Design style brief
  style_preference          TEXT,
  color_primary             TEXT,
  color_secondary           TEXT,
  reference_links           TEXT,
  additional_notes          TEXT,
  brief_json                JSONB,

  -- Variants
  variant_count             INTEGER     NOT NULL DEFAULT 1,

  -- Status flow
  status                    TEXT        NOT NULL DEFAULT 'draft',

  -- Prepress validation (nullable until validate endpoint is called)
  prepress_validation_json  JSONB,
  prepress_validated_at     TIMESTAMPTZ,
  prepress_validated_by     TEXT,

  -- Print readiness guard
  -- INVARIANT: print_ready_at MUST NOT be set while any check has severity=error and passed=false
  print_ready_at            TIMESTAMPTZ,
  print_ready_by            TEXT,

  -- Artwork resolution (optional, validated: 72–1200 dpi; 300+ recommended for print)
  resolution_dpi            INTEGER,

  -- Pricing
  currency                  TEXT        NOT NULL DEFAULT 'IDR',
  quoted_price              NUMERIC(14,2),
  final_price               NUMERIC(14,2),

  -- Deliverables
  deliverable_links         JSONB,
  completion_notes          TEXT,

  -- Audit
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                TIMESTAMPTZ  -- soft delete
);

COMMENT ON COLUMN ai_platform.packaging_design_orders.print_ready_at IS
  'INVARIANT: only set after prepress validation passes with zero error-severity blockers';
COMMENT ON COLUMN ai_platform.packaging_design_orders.prepress_validation_json IS
  'Most-recent validation run result. Full history in packaging_design_validation_log';

-- ── packaging_design_variants ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.packaging_design_variants (
  id                  SERIAL PRIMARY KEY,
  order_id            INTEGER      NOT NULL REFERENCES ai_platform.packaging_design_orders(id) ON DELETE CASCADE,
  variant_name        TEXT         NOT NULL,  -- e.g. "Strawberry 250ml"
  variant_label       TEXT,                  -- short dieline zone label
  sku                 TEXT,
  barcode_value       TEXT,                  -- EAN/UPC/QR data string
  color_accent        TEXT,                  -- variant-specific accent colour
  net_weight          TEXT,                  -- "250 ml", "500 g" etc.

  -- Consistency validation
  consistency_status  TEXT         NOT NULL DEFAULT 'not_validated',  -- not_validated | consistent | inconsistent
  consistency_notes   TEXT,

  -- File references
  dieline_file_url    TEXT,
  artwork_file_url    TEXT,
  mockup_file_url     TEXT,

  status              TEXT         NOT NULL DEFAULT 'active',  -- active | archived
  display_order       INTEGER      NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── packaging_design_validation_log ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.packaging_design_validation_log (
  id            SERIAL PRIMARY KEY,
  order_id      INTEGER      NOT NULL REFERENCES ai_platform.packaging_design_orders(id) ON DELETE CASCADE,
  run_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  run_by        TEXT         NOT NULL DEFAULT 'system',
  outcome       TEXT         NOT NULL,   -- passed | failed | passed_with_warnings
  checks_json   JSONB        NOT NULL,
  warnings_json JSONB        NOT NULL,
  notes         TEXT
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_pkg_orders_email         ON ai_platform.packaging_design_orders(customer_email);
CREATE INDEX IF NOT EXISTS idx_pkg_orders_status        ON ai_platform.packaging_design_orders(status);
CREATE INDEX IF NOT EXISTS idx_pkg_orders_service_type  ON ai_platform.packaging_design_orders(service_type);
CREATE INDEX IF NOT EXISTS idx_pkg_orders_deleted_at    ON ai_platform.packaging_design_orders(deleted_at);
CREATE INDEX IF NOT EXISTS idx_pkg_orders_created_at    ON ai_platform.packaging_design_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pkg_variants_order_id    ON ai_platform.packaging_design_variants(order_id);
CREATE INDEX IF NOT EXISTS idx_pkg_val_log_order_id     ON ai_platform.packaging_design_validation_log(order_id);
