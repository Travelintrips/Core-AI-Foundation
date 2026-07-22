-- =============================================================================
-- Team 34: Design Cost, Usage, and Budget Attribution
-- Migration: design-cost-attribution.sql
--
-- Adds two tables to the ai_platform schema (additive, backward-compatible):
--   1. design_cost_attributions  — per-execution attribution rows that extend
--      ai_cost_records with full design-execution dimensions.
--   2. design_budget_policies    — per-scope budget rules.
--
-- SAFE TO RUN MULTIPLE TIMES: all DDL uses IF NOT EXISTS.
-- Run against: dev and prod Supabase instances.
-- =============================================================================

-- 1. design_cost_attributions -------------------------------------------------

CREATE TABLE IF NOT EXISTS ai_platform.design_cost_attributions (
    id                          SERIAL PRIMARY KEY,

    -- Link to ai_cost_records (nullable — supports cancellation before billing)
    cost_record_id              INTEGER,

    -- Idempotency key (UNIQUE) prevents double-attribution on retries
    idempotency_key             TEXT NOT NULL,

    -- Attribution dimensions
    tenant_id                   TEXT NOT NULL,
    project_id                  TEXT,
    order_id                    TEXT,
    workflow_id                 TEXT,
    stage_id                    TEXT,
    artifact_id                 TEXT,
    capability_id               TEXT,
    plugin_id                   TEXT,
    agent_id                    TEXT,
    job_id                      TEXT,
    attempt                     INTEGER NOT NULL DEFAULT 0,
    provider_id                 TEXT,
    model_id                    TEXT,
    operation_type              TEXT NOT NULL,
    correlation_id              TEXT,

    -- Token usage (NULL = not available / not reported by provider)
    input_tokens                INTEGER,
    output_tokens               INTEGER,
    cached_tokens               INTEGER,

    -- Other usage dimensions
    image_generation_count      INTEGER,
    render_count                INTEGER,
    runtime_seconds             NUMERIC(12, 3),
    storage_bytes               INTEGER,
    request_count               INTEGER NOT NULL DEFAULT 1,
    retry_count                 INTEGER NOT NULL DEFAULT 0,

    -- Cost fields (all nullable — NULL means not yet calculated / unavailable)
    estimated_cost_usd          NUMERIC(12, 8),
    provider_reported_cost_usd  NUMERIC(12, 8),
    calculated_cost_usd         NUMERIC(12, 8),
    adjusted_cost_usd           NUMERIC(12, 8),
    final_attributable_cost_usd NUMERIC(12, 8),

    currency                    TEXT NOT NULL DEFAULT 'USD',
    pricing_version             TEXT,
    pricing_source              TEXT,
    pricing_calculated_at       TIMESTAMPTZ,

    -- Execution outcome
    operation_status            TEXT NOT NULL DEFAULT 'success',
    usage_available             BOOLEAN NOT NULL DEFAULT TRUE,

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS design_cost_attributions_idempotency_key_idx
    ON ai_platform.design_cost_attributions (idempotency_key);

CREATE INDEX IF NOT EXISTS design_cost_attributions_tenant_idx
    ON ai_platform.design_cost_attributions (tenant_id);

CREATE INDEX IF NOT EXISTS design_cost_attributions_project_idx
    ON ai_platform.design_cost_attributions (project_id);

CREATE INDEX IF NOT EXISTS design_cost_attributions_order_idx
    ON ai_platform.design_cost_attributions (order_id);

CREATE INDEX IF NOT EXISTS design_cost_attributions_job_idx
    ON ai_platform.design_cost_attributions (job_id);

CREATE INDEX IF NOT EXISTS design_cost_attributions_created_at_idx
    ON ai_platform.design_cost_attributions (created_at);

-- 2. design_budget_policies ---------------------------------------------------

CREATE TABLE IF NOT EXISTS ai_platform.design_budget_policies (
    id                      SERIAL PRIMARY KEY,

    tenant_id               TEXT NOT NULL,

    -- scope_type: tenant | project | order | workflow | stage | capability
    scope_type              TEXT NOT NULL,
    scope_id                TEXT NOT NULL,

    -- limit_type: per_run | daily | monthly
    limit_type              TEXT NOT NULL,

    -- action_type: soft_warn | hard_block | require_approval
    action_type             TEXT NOT NULL,

    limit_amount_usd        NUMERIC(12, 4) NOT NULL,
    warning_threshold_pct   INTEGER NOT NULL DEFAULT 80,

    currency                TEXT NOT NULL DEFAULT 'USD',
    active                  BOOLEAN NOT NULL DEFAULT TRUE,
    description             TEXT,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS design_budget_policies_tenant_idx
    ON ai_platform.design_budget_policies (tenant_id);

CREATE INDEX IF NOT EXISTS design_budget_policies_scope_idx
    ON ai_platform.design_budget_policies (scope_type, scope_id);

CREATE INDEX IF NOT EXISTS design_budget_policies_active_idx
    ON ai_platform.design_budget_policies (active);

-- =============================================================================
-- End of migration
-- =============================================================================
