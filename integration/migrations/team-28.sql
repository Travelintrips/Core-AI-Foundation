-- ============================================================================
-- Team 28 — Furniture & Product Design Plugin — Database Migration
-- Schema: ai_platform
--
-- STATUS: DRAFT — do NOT apply directly.
--         Team 39 (integration) to apply via controlled migration process.
--
-- Tables created:
--   ai_platform.pd_plugin_projects
--   ai_platform.pd_plugin_briefs
--   ai_platform.pd_plugin_outputs
--
-- Safe to run multiple times (idempotent via IF NOT EXISTS).
-- ============================================================================

-- ── pd_plugin_projects ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.pd_plugin_projects (
    id                  SERIAL PRIMARY KEY,

    -- Identity
    title               TEXT NOT NULL,
    product_category    TEXT NOT NULL,
    client_name         TEXT,
    client_email        TEXT,
    notes               TEXT,

    -- Lifecycle
    status              TEXT NOT NULL DEFAULT 'draft',
    current_step        TEXT NOT NULL DEFAULT 'brief',
    completed_steps     JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Access control (IDOR guard — same pattern as id_projects / fashion_design_orders)
    access_token        TEXT NOT NULL UNIQUE,

    -- Export
    exported_at         TIMESTAMPTZ,
    export_package_url  TEXT,

    -- Admin
    admin_notes         TEXT,
    assigned_designer   TEXT,

    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Status check constraint
ALTER TABLE ai_platform.pd_plugin_projects
    DROP CONSTRAINT IF EXISTS pd_plugin_projects_status_check;
ALTER TABLE ai_platform.pd_plugin_projects
    ADD CONSTRAINT pd_plugin_projects_status_check
    CHECK (status IN (
        'draft', 'brief_submitted', 'researching', 'concepting',
        'developing', 'specifying', 'reviewing', 'approved', 'exported', 'cancelled'
    ));

-- Product category check constraint
ALTER TABLE ai_platform.pd_plugin_projects
    DROP CONSTRAINT IF EXISTS pd_plugin_projects_category_check;
ALTER TABLE ai_platform.pd_plugin_projects
    ADD CONSTRAINT pd_plugin_projects_category_check
    CHECK (product_category IN (
        'seating', 'table', 'storage', 'bed', 'shelving',
        'outdoor_furniture', 'lighting_fixture', 'consumer_electronics',
        'appliance', 'tool', 'toy', 'medical_device', 'industrial', 'other'
    ));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pd_plugin_projects_status
    ON ai_platform.pd_plugin_projects (status);

CREATE INDEX IF NOT EXISTS idx_pd_plugin_projects_category
    ON ai_platform.pd_plugin_projects (product_category);

CREATE INDEX IF NOT EXISTS idx_pd_plugin_projects_access_token
    ON ai_platform.pd_plugin_projects (access_token);

CREATE INDEX IF NOT EXISTS idx_pd_plugin_projects_created_at
    ON ai_platform.pd_plugin_projects (created_at DESC);

-- ── pd_plugin_briefs ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.pd_plugin_briefs (
    id                      SERIAL PRIMARY KEY,
    project_id              INTEGER NOT NULL
                                REFERENCES ai_platform.pd_plugin_projects(id)
                                ON DELETE CASCADE,

    -- 13 core brief fields
    product_category        TEXT NOT NULL,
    target_user             TEXT NOT NULL,
    environment             TEXT NOT NULL,
    primary_function        TEXT NOT NULL,

    -- Dimensions
    width_mm                NUMERIC(10, 2),
    depth_mm                NUMERIC(10, 2),
    height_mm               NUMERIC(10, 2),
    weight_kg               NUMERIC(10, 3),
    custom_dimensions       TEXT,

    -- Ergonomics & load
    ergonomics_notes        TEXT,
    load_usage_notes        TEXT,

    -- Materials
    primary_materials       JSONB NOT NULL DEFAULT '[]'::jsonb,
    finish_preferences      JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Manufacturing
    manufacturing_process   TEXT,
    production_volume       TEXT,

    -- Budget
    budget_currency         TEXT NOT NULL DEFAULT 'IDR',
    budget_estimate         NUMERIC(15, 2),
    budget_notes            TEXT,

    -- Responsibility
    sustainability_goals    TEXT,
    safety_requirements     TEXT,
    compliance_standards    JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Additional
    reference_urls          JSONB NOT NULL DEFAULT '[]'::jsonb,
    additional_notes        TEXT,

    -- Timestamps
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One brief per project (upsert pattern)
CREATE UNIQUE INDEX IF NOT EXISTS idx_pd_plugin_briefs_project_id
    ON ai_platform.pd_plugin_briefs (project_id);

-- ── pd_plugin_outputs ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.pd_plugin_outputs (
    id                      SERIAL PRIMARY KEY,
    project_id              INTEGER NOT NULL
                                REFERENCES ai_platform.pd_plugin_projects(id)
                                ON DELETE CASCADE,

    -- Step and artifact type
    workflow_step           TEXT NOT NULL,
    artifact_type           TEXT NOT NULL,

    -- Generated content
    content                 JSONB NOT NULL DEFAULT '{}'::jsonb,
    validation_results      JSONB,
    disclaimers             JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- AI metadata
    ai_model_used           TEXT,
    generation_duration_ms  INTEGER,
    is_approved             BOOLEAN NOT NULL DEFAULT FALSE,
    is_latest               BOOLEAN NOT NULL DEFAULT TRUE,
    review_notes            TEXT,

    -- Timestamps
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Workflow step check
ALTER TABLE ai_platform.pd_plugin_outputs
    DROP CONSTRAINT IF EXISTS pd_plugin_outputs_step_check;
ALTER TABLE ai_platform.pd_plugin_outputs
    ADD CONSTRAINT pd_plugin_outputs_step_check
    CHECK (workflow_step IN (
        'brief', 'user_market_research', 'functional_requirements',
        'concept_direction', 'concept_sketch', 'form_development',
        'material_component_selection', 'orthographic_technical_view',
        'visualization', 'prototype_specification', 'review', 'export'
    ));

-- Artifact type check
ALTER TABLE ai_platform.pd_plugin_outputs
    DROP CONSTRAINT IF EXISTS pd_plugin_outputs_artifact_type_check;
ALTER TABLE ai_platform.pd_plugin_outputs
    ADD CONSTRAINT pd_plugin_outputs_artifact_type_check
    CHECK (artifact_type IN (
        'product_moodboard', 'product_concept_sketch', 'product_form_study',
        'product_component_map', 'product_material_spec', 'product_orthographic_view',
        'product_visualization', 'product_prototype_spec', 'product_production_spec'
    ));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pd_plugin_outputs_project_id
    ON ai_platform.pd_plugin_outputs (project_id);

CREATE INDEX IF NOT EXISTS idx_pd_plugin_outputs_step_latest
    ON ai_platform.pd_plugin_outputs (project_id, workflow_step, is_latest)
    WHERE is_latest = TRUE;

CREATE INDEX IF NOT EXISTS idx_pd_plugin_outputs_approved
    ON ai_platform.pd_plugin_outputs (project_id, is_approved)
    WHERE is_approved = TRUE;
