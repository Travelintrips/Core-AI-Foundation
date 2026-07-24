-- Migration: Add provider health tracking columns to ai_providers
-- Tracks when each provider was last checked, last succeeded, and how many
-- consecutive failures have occurred. All columns are nullable/defaulted so
-- existing rows need no backfill and the ALTER is safe on a live database.

ALTER TABLE ai_platform.ai_providers
  ADD COLUMN IF NOT EXISTS last_checked_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_success_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0;
