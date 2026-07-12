-- DDL: Sprint P2.1.1 — Background Asset Archiving / Asset Lifecycle
-- Additive only. Run once against the Supabase dev/prod database.
-- All tables live in the ai_platform schema.

SET search_path TO ai_platform, public;

-- ── Additive lifecycle columns on ai_portfolio_assets ──────────────────────────
-- Overall lifecycle: queued | generating | generated | archiving | archived |
--                     optimized | published
-- Failure states:     archive_failed | optimize_failed | thumbnail_failed

ALTER TABLE ai_platform.ai_portfolio_assets
  ADD COLUMN IF NOT EXISTS status               TEXT NOT NULL DEFAULT 'generated',
  ADD COLUMN IF NOT EXISTS source_url           TEXT,
  ADD COLUMN IF NOT EXISTS archive_status       TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS archive_started_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archive_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archive_attempts     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS archive_error        TEXT,
  ADD COLUMN IF NOT EXISTS storage_provider     TEXT,
  ADD COLUMN IF NOT EXISTS storage_bucket       TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_status     TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS optimization_status  TEXT NOT NULL DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS ai_portfolio_assets_status_idx
  ON ai_platform.ai_portfolio_assets(status);

CREATE INDEX IF NOT EXISTS ai_portfolio_assets_archive_status_idx
  ON ai_platform.ai_portfolio_assets(archive_status);

-- ── Backfill: mark any pre-existing rows that already have a storage_path as
--    archived (they were archived by the old fire-and-forget flow) ─────────────
UPDATE ai_platform.ai_portfolio_assets
SET status = 'archived', archive_status = 'completed', archive_completed_at = NOW()
WHERE storage_path IS NOT NULL AND archive_status = 'pending';
