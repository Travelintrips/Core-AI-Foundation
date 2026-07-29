-- =============================================================================
-- WP-03A Placement Engine — Tenant Consistency Triggers (v2 rebuild)
-- Migration: wp03a-placement-tenant-consistency-v2.sql
--
-- Implements:
--   Trigger 1: trg_placements_tenant_consistency
--     BEFORE INSERT OR UPDATE OF (session_id, tenant_id) ON placements
--     Ensures: placement.tenant_id IS NOT DISTINCT FROM session.tenant_id
--
--   Trigger 2: trg_layout_sessions_protect_tenant
--     BEFORE UPDATE OF (tenant_id) ON layout_sessions
--     Prevents changing session.tenant_id when placements exist.
--
-- NULL-safe matching semantics:
--   session NULL  + placement NULL  → allowed
--   session T1    + placement T1   → allowed
--   session NULL  + placement T1   → REJECTED
--   session T1    + placement NULL → REJECTED
--   session T1    + placement T2   → REJECTED
--
-- Error codes raised:
--   PLACEMENT_TENANT_MISMATCH     (check_violation / P0004)
--   PLACEMENT_SESSION_NOT_FOUND   (foreign_key_violation / 23503)
--   LAYOUT_SESSION_TENANT_LOCKED  (check_violation / P0004)
--
-- Rules:
--   • Idempotent — CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS
--   • Must run AFTER wp03a-placement-engine-v2.sql
--   • Does not weaken RLS
--   • Does not delete data
--   • No duplicate tables
-- =============================================================================

SET search_path TO ai_platform, public;

-- =============================================================================
-- Function 1: Validate placement tenant matches session tenant
-- =============================================================================

CREATE OR REPLACE FUNCTION ai_platform.fn_placements_tenant_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session_tenant_id UUID;
  v_session_found     BOOLEAN;
BEGIN
  -- Resolve the session's tenant_id
  SELECT tenant_id, TRUE
    INTO v_session_tenant_id, v_session_found
    FROM ai_platform.layout_sessions
    WHERE id = NEW.session_id;

  IF NOT v_session_found THEN
    RAISE EXCEPTION 'PLACEMENT_SESSION_NOT_FOUND: session_id % does not exist', NEW.session_id
      USING ERRCODE = '23503';  -- foreign_key_violation
  END IF;

  -- NULL-safe equality check
  -- IS NOT DISTINCT FROM returns TRUE when both are NULL, or both equal non-NULL
  IF NEW.tenant_id IS NOT DISTINCT FROM v_session_tenant_id THEN
    RETURN NEW;  -- consistent → allow
  END IF;

  -- Mismatch → reject
  RAISE EXCEPTION 'PLACEMENT_TENANT_MISMATCH: placement.tenant_id (%) does not match session.tenant_id (%) for session_id %',
    NEW.tenant_id::text,
    v_session_tenant_id::text,
    NEW.session_id::text
    USING ERRCODE = 'P0004';  -- check_violation

END;
$$;

-- Trigger: fire on INSERT and on UPDATE of session_id or tenant_id
DROP TRIGGER IF EXISTS trg_placements_tenant_consistency
  ON ai_platform.placements;

CREATE TRIGGER trg_placements_tenant_consistency
  BEFORE INSERT OR UPDATE OF session_id, tenant_id
  ON ai_platform.placements
  FOR EACH ROW
  EXECUTE FUNCTION ai_platform.fn_placements_tenant_consistency();

-- =============================================================================
-- Function 2: Prevent changing session.tenant_id when placements exist
-- =============================================================================

CREATE OR REPLACE FUNCTION ai_platform.fn_layout_sessions_protect_tenant_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_placement_count BIGINT;
BEGIN
  -- Only act when tenant_id is actually changing
  IF NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)
    INTO v_placement_count
    FROM ai_platform.placements
    WHERE session_id = NEW.id;

  IF v_placement_count > 0 THEN
    RAISE EXCEPTION 'LAYOUT_SESSION_TENANT_LOCKED: cannot change tenant_id on session % because % active/archived placements exist. Move or delete placements first.',
      NEW.id::text,
      v_placement_count
      USING ERRCODE = 'P0004';  -- check_violation
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger: fire only on UPDATE OF tenant_id on layout_sessions
DROP TRIGGER IF EXISTS trg_layout_sessions_protect_tenant
  ON ai_platform.layout_sessions;

CREATE TRIGGER trg_layout_sessions_protect_tenant
  BEFORE UPDATE OF tenant_id
  ON ai_platform.layout_sessions
  FOR EACH ROW
  EXECUTE FUNCTION ai_platform.fn_layout_sessions_protect_tenant_update();

-- =============================================================================
-- Verification queries (run after applying):
--
-- 1. Functions exist:
--    SELECT proname FROM pg_proc
--    WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'ai_platform')
--    AND proname IN ('fn_placements_tenant_consistency',
--                    'fn_layout_sessions_protect_tenant_update');
--    Expected: 2 rows.
--
-- 2. Triggers exist:
--    SELECT trigger_name, event_manipulation, event_object_table
--    FROM information_schema.triggers
--    WHERE trigger_schema = 'ai_platform'
--    AND trigger_name IN ('trg_placements_tenant_consistency',
--                          'trg_layout_sessions_protect_tenant');
--    Expected: 3 rows (INSERT+UPDATE for placements, UPDATE for sessions).
--
-- 3. NULL/NULL insert succeeds:
--    INSERT INTO ai_platform.layout_sessions (name, room_width_cm, room_length_cm)
--      VALUES ('test', 500, 600) RETURNING id;
--    -- capture session_id, then:
--    INSERT INTO ai_platform.placements
--      (session_id, furniture_item_id, width_cm, depth_cm, height_cm)
--      VALUES (<session_id>, gen_random_uuid(), 90, 60, 85);
--    Expected: success.
--
-- 4. Cross-tenant insert fails:
--    INSERT INTO ai_platform.layout_sessions
--      (tenant_id, name, room_width_cm, room_length_cm)
--      VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'T1', 500, 600) RETURNING id;
--    INSERT INTO ai_platform.placements
--      (tenant_id, session_id, furniture_item_id, width_cm, depth_cm, height_cm)
--      VALUES ('bbbbbbbb-0000-0000-0000-000000000002', <session_id>, gen_random_uuid(), 90, 60, 85);
--    Expected: ERROR PLACEMENT_TENANT_MISMATCH.
-- =============================================================================
