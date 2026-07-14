-- WP-04/WP-05: Soft Delete & Archive/Retention/Purge Migration
-- Hand-written DDL (do NOT use drizzle-kit push for ai_platform schema —
-- it proposes dropping the entire schema even for additive changes).
-- Run against Supabase dev database first, then production.
--
-- Safe to re-run: all statements use IF NOT EXISTS / IF EXISTS guards.

SET search_path TO ai_platform, public;

-- ─── ai_installed_packages ────────────────────────────────────────────────────

ALTER TABLE ai_platform.ai_installed_packages
  ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Partial indexes: only index rows that are actually deleted/archived,
-- keeping the default-path (deleted_at IS NULL) queries on the main index.
CREATE INDEX IF NOT EXISTS idx_installed_packages_deleted_at
  ON ai_platform.ai_installed_packages (deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_installed_packages_archived_at
  ON ai_platform.ai_installed_packages (archived_at)
  WHERE archived_at IS NOT NULL;

-- Purge eligibility: composite index for the retention-sweep query
-- (deleted_at IS NOT NULL AND deleted_at < $cutoff).
CREATE INDEX IF NOT EXISTS idx_installed_packages_purge_eligible
  ON ai_platform.ai_installed_packages (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- ─── ai_service_requests ──────────────────────────────────────────────────────

ALTER TABLE ai_platform.ai_service_requests
  ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_service_requests_deleted_at
  ON ai_platform.ai_service_requests (deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_service_requests_archived_at
  ON ai_platform.ai_service_requests (archived_at)
  WHERE archived_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_service_requests_purge_eligible
  ON ai_platform.ai_service_requests (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- ─── creative_projects ────────────────────────────────────────────────────────

ALTER TABLE ai_platform.creative_projects
  ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_creative_projects_deleted_at
  ON ai_platform.creative_projects (deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_creative_projects_archived_at
  ON ai_platform.creative_projects (archived_at)
  WHERE archived_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_creative_projects_purge_eligible
  ON ai_platform.creative_projects (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- ─── Verify ───────────────────────────────────────────────────────────────────
-- Quick sanity check: confirm the columns exist on all three tables.

SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'ai_platform'
  AND column_name IN ('deleted_at', 'archived_at')
  AND table_name IN ('ai_installed_packages', 'ai_service_requests', 'creative_projects')
ORDER BY table_name, column_name;
