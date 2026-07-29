-- ============================================================
-- WP-03A: Placement Engine — tenant consistency trigger (v2)
-- Schema: ai_platform
-- Idempotent: CREATE OR REPLACE / DROP TRIGGER IF EXISTS
-- Do NOT apply to production without a dry-run review.
-- ============================================================

SET search_path TO ai_platform, public;

-- ── Function: enforce placements.tenant_id = session.tenant_id ───────────────
-- Prevents a placement from being inserted or updated with a tenant_id that
-- does not match its parent layout_session.tenant_id.

CREATE OR REPLACE FUNCTION ai_platform.check_placement_tenant_consistency()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  session_tenant_id UUID;
BEGIN
  SELECT tenant_id INTO session_tenant_id
  FROM ai_platform.layout_sessions
  WHERE id = NEW.session_id;

  IF session_tenant_id IS NULL THEN
    RAISE EXCEPTION 'placement_engine: layout_session % not found', NEW.session_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.tenant_id != session_tenant_id THEN
    RAISE EXCEPTION 'placement_engine: placement.tenant_id % does not match session.tenant_id %',
      NEW.tenant_id, session_tenant_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- ── Trigger: fire on INSERT and UPDATE ───────────────────────────────────────

DROP TRIGGER IF EXISTS trg_placement_tenant_consistency ON ai_platform.placements;

CREATE TRIGGER trg_placement_tenant_consistency
  BEFORE INSERT OR UPDATE OF session_id, tenant_id
  ON ai_platform.placements
  FOR EACH ROW
  EXECUTE FUNCTION ai_platform.check_placement_tenant_consistency();

COMMENT ON FUNCTION ai_platform.check_placement_tenant_consistency() IS
  'Ensures placements.tenant_id always mirrors layout_sessions.tenant_id to maintain multi-tenant integrity.';

-- ============================================================
-- Rollback notes:
--   DROP TRIGGER IF EXISTS trg_placement_tenant_consistency ON ai_platform.placements;
--   DROP FUNCTION IF EXISTS ai_platform.check_placement_tenant_consistency();
-- ============================================================
