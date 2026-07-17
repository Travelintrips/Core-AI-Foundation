-- ============================================================
-- Team 21 — Creative Marketplace Category Extension
-- Status: DRAFT_DEFERRED
--
-- The parallel cm2_* table engine has been reverted per consolidation review.
-- License and compat metadata are stored in the EXISTING
-- marketplace_assets.metadata JSONB column — no new tables required.
--
-- This file contains ADDITIVE-ONLY column proposals for existing V4.7 tables.
-- DO NOT APPLY until Team 24 architecture review is complete.
-- ============================================================

-- ── DEFERRED: The 7 cm2_* tables (cm2_listings, cm2_creator_profiles,
-- cm2_favorites, cm2_ratings, cm2_downloads, cm2_moderation_log,
-- cm2_analytics_snapshots) have been removed from this migration.
-- They duplicated existing marketplace_* tables and are not needed
-- while license/compat metadata lives in marketplace_assets.metadata JSONB.

-- ── ADDITIVE PROPOSAL — only if Team 24 decides separate columns are needed ──
-- (Do not apply — pending architecture review)

-- Option A: Add license_type column to existing marketplace_assets
-- (Only if Team 24 confirms metadata JSONB is insufficient for indexing)
--
-- ALTER TABLE ai_platform.marketplace_assets
--   ADD COLUMN IF NOT EXISTS license_type TEXT NOT NULL DEFAULT 'standard';
--
-- ALTER TABLE ai_platform.marketplace_assets
--   ADD COLUMN IF NOT EXISTS compat_contexts JSONB NOT NULL DEFAULT '[]';
--
-- CREATE INDEX IF NOT EXISTS marketplace_assets_license_type_idx
--   ON ai_platform.marketplace_assets (license_type);

-- ── CURRENT APPROACH (no migration needed) ────────────────────────────────────
-- License metadata → marketplace_assets.metadata->>'licenseMetadata' (JSONB)
-- Compat metadata  → marketplace_assets.metadata->>'compatMetadata' (JSONB)
-- Item type vocab  → marketplace_assets.asset_type TEXT (existing column, new values)
-- Category taxonomy → application-level contract (MARKETPLACE_CATEGORY_EXTENSION)

-- ── END OF DEFERRED MIGRATION ─────────────────────────────────────────────────
