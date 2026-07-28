-- ─────────────────────────────────────────────────────────────────────────────
-- WP-01 RLS — Room Template Library
-- Release blocker identified during WP-01 release lock audit (2026-07-28).
--
-- Context:
--   Platform RLS strategy is defined in rls-v12.sql (WP-12).
--   The five WP-01 tables were NOT included in that migration and have no
--   database-level RLS as of the material-v6.0.0-wp01 tag.
--
-- This migration follows the exact same strategy as rls-v12.sql:
--   • Tables WITHOUT tenant_id → ENABLE RLS + allow_authenticated USING (true)
--     (auth is enforced at the application layer; RLS is defence-in-depth)
--   • Tables WITH tenant_id   → ENABLE + FORCE RLS + tenant_isolation policy
--     filtering by session variable app.current_tenant_id
--   • Service-role connections bypass RLS (BYPASSRLS privilege on service key).
--
-- DO NOT apply automatically.
-- Apply to DEV first, then PROD after validation.
-- Run verification queries at the bottom after applying.
-- ─────────────────────────────────────────────────────────────────────────────

SET search_path TO ai_platform, public;

-- ── 1. room_types  (no tenant_id — catalog data, app-layer auth gate) ─────────
ALTER TABLE ai_platform.room_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated ON ai_platform.room_types;
CREATE POLICY allow_authenticated ON ai_platform.room_types
  USING (true);

-- ── 2. room_styles  (no tenant_id — catalog data, app-layer auth gate) ────────
ALTER TABLE ai_platform.room_styles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated ON ai_platform.room_styles;
CREATE POLICY allow_authenticated ON ai_platform.room_styles
  USING (true);

-- ── 3. room_themes  (no tenant_id — catalog data, app-layer auth gate) ────────
ALTER TABLE ai_platform.room_themes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated ON ai_platform.room_themes;
CREATE POLICY allow_authenticated ON ai_platform.room_themes
  USING (true);

-- ── 4. layout_constraint_sets  (no tenant_id — catalog data) ─────────────────
ALTER TABLE ai_platform.layout_constraint_sets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated ON ai_platform.layout_constraint_sets;
CREATE POLICY allow_authenticated ON ai_platform.layout_constraint_sets
  USING (true);

-- ── 5. room_templates  (has nullable tenant_id — tenant_isolation policy) ─────
--
-- NULL tenant_id = platform-wide template → visible to all tenants
-- Non-NULL tenant_id = scoped to a specific tenant
ALTER TABLE ai_platform.room_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.room_templates FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON ai_platform.room_templates;
CREATE POLICY tenant_isolation ON ai_platform.room_templates
  USING (
    tenant_id IS NULL
    OR tenant_id::text = COALESCE(
      current_setting('app.current_tenant_id', true),
      ''
    )
  )
  WITH CHECK (
    -- Writes must target the current tenant's scope or a platform-global row.
    -- Prevents a tenant inserting/updating a row owned by another tenant.
    tenant_id IS NULL
    OR tenant_id::text = COALESCE(
      current_setting('app.current_tenant_id', true),
      ''
    )
  );

-- ── Verification queries ──────────────────────────────────────────────────────
-- Run these as a non-service-role (e.g. anon key) WITHOUT setting the tenant:
--
--   SET search_path TO ai_platform;
--   SELECT count(*) FROM room_types;              -- must return > 0 (allow all)
--   SELECT count(*) FROM room_styles;             -- must return > 0 (allow all)
--   SELECT count(*) FROM room_themes;             -- must return > 0 (allow all)
--   SELECT count(*) FROM layout_constraint_sets;  -- must return 0 (none seeded yet)
--   SELECT count(*) FROM room_templates
--     WHERE tenant_id IS NOT NULL;                -- must return 0 (fail-closed)
--
-- And with the correct tenant set:
--   SELECT set_config('app.current_tenant_id', '<tenant-uuid>', true);
--   SELECT count(*) FROM room_templates;          -- must return platform-wide count + tenant rows
