-- ─────────────────────────────────────────────────────────────────────────────
-- WP-02 RLS — Furniture & Object Library
-- Phase 6 — follows the same strategy as rls-wp01-room-templates.sql
--
-- Strategy (identical to rls-v12.sql and rls-wp01-room-templates.sql):
--   • Tables WITHOUT tenant_id → ENABLE RLS + allow_authenticated USING (true)
--     (application-layer auth is the primary gate; RLS is defence-in-depth)
--   • Tables WITH tenant_id    → ENABLE + FORCE RLS + tenant_isolation policy
--     filtering by session variable app.current_tenant_id
--   • Service-role connections bypass RLS (BYPASSRLS on service key).
--
-- DO NOT apply automatically.
-- Apply to DEV first. After validation apply to PROD.
-- ─────────────────────────────────────────────────────────────────────────────

SET search_path TO ai_platform, public;

-- ── 1. furniture_categories  (no tenant_id — catalog data) ───────────────────
ALTER TABLE ai_platform.furniture_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated ON ai_platform.furniture_categories;
CREATE POLICY allow_authenticated ON ai_platform.furniture_categories
  USING (true);

-- ── 2. furniture_brands  (no tenant_id — catalog data) ───────────────────────
ALTER TABLE ai_platform.furniture_brands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated ON ai_platform.furniture_brands;
CREATE POLICY allow_authenticated ON ai_platform.furniture_brands
  USING (true);

-- ── 3. furniture_collections  (no tenant_id — catalog data) ──────────────────
ALTER TABLE ai_platform.furniture_collections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated ON ai_platform.furniture_collections;
CREATE POLICY allow_authenticated ON ai_platform.furniture_collections
  USING (true);

-- ── 4. furniture_items  (has nullable tenant_id — tenant isolation) ───────────
--
-- NULL tenant_id = platform-wide item visible to all tenants.
-- Non-NULL tenant_id = scoped to a specific tenant only.
ALTER TABLE ai_platform.furniture_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.furniture_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON ai_platform.furniture_items;
CREATE POLICY tenant_isolation ON ai_platform.furniture_items
  USING (
    tenant_id IS NULL
    OR tenant_id::text = COALESCE(
      current_setting('app.current_tenant_id', true),
      ''
    )
  )
  WITH CHECK (
    tenant_id IS NULL
    OR tenant_id::text = COALESCE(
      current_setting('app.current_tenant_id', true),
      ''
    )
  );

-- ── 5. furniture_assets  (inherits via FK — no separate tenant_id) ────────────
ALTER TABLE ai_platform.furniture_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated ON ai_platform.furniture_assets;
CREATE POLICY allow_authenticated ON ai_platform.furniture_assets
  USING (true);

-- ── 6. furniture_tags  (no tenant_id — catalog data) ─────────────────────────
ALTER TABLE ai_platform.furniture_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated ON ai_platform.furniture_tags;
CREATE POLICY allow_authenticated ON ai_platform.furniture_tags
  USING (true);

-- ── 7. furniture_item_tags  (no tenant_id — join table, inherits from item) ───
ALTER TABLE ai_platform.furniture_item_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated ON ai_platform.furniture_item_tags;
CREATE POLICY allow_authenticated ON ai_platform.furniture_item_tags
  USING (true);

-- ── Verification queries ──────────────────────────────────────────────────────
-- Run as non-service-role (anon key) WITHOUT setting the tenant:
--
--   SET search_path TO ai_platform;
--   SELECT count(*) FROM furniture_categories;     -- must return > 0 (allow all)
--   SELECT count(*) FROM furniture_brands;         -- must return > 0 (allow all)
--   SELECT count(*) FROM furniture_collections;    -- must return > 0 (allow all)
--   SELECT count(*) FROM furniture_tags;           -- must return > 0 (allow all)
--   SELECT count(*) FROM furniture_items
--     WHERE tenant_id IS NOT NULL;                 -- must return 0 (fail-closed)
--
-- With the correct tenant set:
--   SELECT set_config('app.current_tenant_id', '<tenant-uuid>', true);
--   SELECT count(*) FROM furniture_items;          -- returns platform-wide + tenant rows
