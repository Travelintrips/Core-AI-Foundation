-- WP-09 DDL: Soft-delete columns for Quotation domain tables
-- Run once against the Supabase dev/prod database (additive, zero behaviour change).
--
-- Three tables:
--   ai_platform.ai_quotations            (canonical service-catalog quotations)
--   ai_platform.ai_quotation_items       (line items; CASCADE-deleted today → soft-cascade in code)
--   public.creative_project_quotations   (legacy per-project quotations; frozen for new writes)
--
-- All columns stay nullable forever — NULL = not deleted (the mechanism).
-- Partial indexes on deleted_at WHERE deleted_at IS NULL are the hot-path
-- indexes: every default read filters for exactly this predicate.
--
-- Companion: lib/db/src/schema/ai-quotations.ts, ai-quotation-items.ts,
--            creative-project-quotations.ts  (Drizzle schema mirrors)
--            repositories/quotationRepository.ts  (filtering logic)

-- ── ai_platform.ai_quotations ─────────────────────────────────────────────────

ALTER TABLE ai_platform.ai_quotations
  ADD COLUMN IF NOT EXISTS deleted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by  text;        -- actorId (internal user or customer id)

CREATE INDEX IF NOT EXISTS ai_quotations_not_deleted_idx
  ON ai_platform.ai_quotations (id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ai_quotations_tenant_not_deleted_idx
  ON ai_platform.ai_quotations (tenant_id)
  WHERE deleted_at IS NULL;

-- ── ai_platform.ai_quotation_items ───────────────────────────────────────────

ALTER TABLE ai_platform.ai_quotation_items
  ADD COLUMN IF NOT EXISTS deleted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by  text;

CREATE INDEX IF NOT EXISTS ai_quotation_items_not_deleted_idx
  ON ai_platform.ai_quotation_items (quotation_id)
  WHERE deleted_at IS NULL;

-- ── public.creative_project_quotations ───────────────────────────────────────
-- This table lives in the public schema (no ai_platform prefix) because it
-- predates the schema-isolation work and is frozen for new writes.

ALTER TABLE creative_project_quotations
  ADD COLUMN IF NOT EXISTS deleted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by  text;

CREATE INDEX IF NOT EXISTS creative_project_quotations_not_deleted_idx
  ON creative_project_quotations (project_id)
  WHERE deleted_at IS NULL;
