-- ============================================================
-- Team 8 — Universal Creative Component Library
-- Migration Draft (NOT YET APPLIED)
-- Branch: feature/08-component-library
-- ============================================================
-- Rules:
--   • Additive only — no DROP, TRUNCATE, or destructive renames
--   • All tables in the ai_platform schema
--   • Indexes use CREATE INDEX IF NOT EXISTS
--   • Do NOT run directly — Team 24 applies this during integration
-- ============================================================

-- Saved component instances
CREATE TABLE IF NOT EXISTS ai_platform.ai_design_components (
    id              SERIAL PRIMARY KEY,
    tenant_id       TEXT        NOT NULL,
    name            TEXT        NOT NULL,
    slug            TEXT        NOT NULL,
    type            TEXT        NOT NULL,
    domain          TEXT        NOT NULL
                        CHECK (domain IN ('graphic', 'interior', 'fashion', 'packaging')),
    field_values    JSONB       NOT NULL DEFAULT '{}',
    blueprint_id    TEXT,
    status          TEXT        NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'archived')),
    created_by      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

-- Unique constraint: one slug per tenant (active or soft-deleted)
-- Ensures slug uniqueness within a tenant's namespace regardless of status.
ALTER TABLE ai_platform.ai_design_components
    ADD CONSTRAINT uq_ai_design_components_tenant_slug UNIQUE (tenant_id, slug);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_design_components_tenant_id
    ON ai_platform.ai_design_components(tenant_id);

CREATE INDEX IF NOT EXISTS idx_ai_design_components_domain
    ON ai_platform.ai_design_components(domain);

CREATE INDEX IF NOT EXISTS idx_ai_design_components_type
    ON ai_platform.ai_design_components(type);

CREATE INDEX IF NOT EXISTS idx_ai_design_components_blueprint_id
    ON ai_platform.ai_design_components(blueprint_id)
    WHERE blueprint_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_design_components_status
    ON ai_platform.ai_design_components(status)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ai_design_components_tenant_domain
    ON ai_platform.ai_design_components(tenant_id, domain)
    WHERE deleted_at IS NULL;
