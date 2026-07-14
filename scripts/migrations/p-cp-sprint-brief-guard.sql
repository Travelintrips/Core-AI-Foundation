-- Company Profile Full Sprint — Workstream 1 (P0)
-- Hand-written DDL (do NOT use drizzle-kit push for ai_platform schema)
-- Run against Supabase dev database

SET search_path TO ai_platform, public;

-- Admin override for the brief-completeness production guard. Nullable —
-- only populated when an admin explicitly overrides a BRIEF_INCOMPLETE block.
ALTER TABLE ai_platform.ai_service_requests
  ADD COLUMN IF NOT EXISTS brief_guard_override_reason TEXT,
  ADD COLUMN IF NOT EXISTS brief_guard_override_by     TEXT,
  ADD COLUMN IF NOT EXISTS brief_guard_override_at     TIMESTAMPTZ;
