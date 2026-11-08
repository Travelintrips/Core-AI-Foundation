-- DEV-ONLY PROPOSAL. NOT APPLIED. REVIEW schema/permissions before execution.
-- Atomic grant consume + command-exclusive lease claim in ONE database transaction.
-- No worker dispatch, no resume enqueue, no mutations to existing command tables.
-- This intentionally defines new DEV-only objects; production migration is forbidden.
-- CAUTION: the claim function is deliberately INERT (always throws 0A000) until
-- all server-owned attestation/rate-limit/authorization gates are verified.
-- Exact review linkage is required for APPROVED grants. This also means the
-- separate DEV review-intents migration must exist before this proposal can run.
-- This is a DDL proposal ONLY; not an issuer or authorization to execute.
CREATE UNIQUE INDEX IF NOT EXISTS dev_gpt02_review_intent_binding_key
 ON ai_platform.dev_gpt02_operator_review_intents
 (id,command_id,checkpoint_response_id,blocker_response_id,worker_id,operator_user_id);
CREATE TABLE IF NOT EXISTS ai_platform.dev_gpt02_resume_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id uuid NOT NULL REFERENCES ai_platform.ai_coding_bridge_commands(id),
  review_intent_id uuid,
  operator_user_id integer,
  blocker_response_id uuid NOT NULL REFERENCES ai_platform.ai_coding_bridge_responses(id),
  checkpoint_response_id uuid NOT NULL REFERENCES ai_platform.ai_coding_bridge_responses(id),
  worker_id text NOT NULL CHECK (length(trim(worker_id)) > 0),
  status text NOT NULL CHECK (status IN ('PENDING','APPROVED','REVOKED','CONSUMED')),
  approved_by text,
  approved_at timestamptz,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT dev_gpt02_grant_review_binding_fk FOREIGN KEY
   (review_intent_id,command_id,checkpoint_response_id,blocker_response_id,worker_id,operator_user_id)
   REFERENCES ai_platform.dev_gpt02_operator_review_intents
   (id,command_id,checkpoint_response_id,blocker_response_id,worker_id,operator_user_id),
  CHECK (status NOT IN ('APPROVED','CONSUMED') OR (review_intent_id IS NOT NULL AND operator_user_id IS NOT NULL)),
  CHECK (status NOT IN ('APPROVED','CONSUMED') OR
    (approved_by IS NOT NULL AND approved_by = 'internal:' || operator_user_id::text) IS TRUE),
  CHECK (status NOT IN ('APPROVED','CONSUMED') OR
    (approved_at IS NOT NULL AND expires_at <= approved_at + interval '120 seconds') IS TRUE),
  CHECK (approved_at IS NULL OR approved_at >= created_at - interval '5 seconds'),
  CHECK (status <> 'APPROVED' OR (approved_by IS NOT NULL AND length(trim(approved_by)) > 0 AND approved_at IS NOT NULL)),
  CHECK (approved_at IS NULL OR expires_at > approved_at),
  CHECK (status <> 'CONSUMED' OR consumed_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS dev_gpt02_resume_grants_one_live_per_command
  ON ai_platform.dev_gpt02_resume_grants (command_id) WHERE status IN ('PENDING','APPROVED');

-- A single signed human review may back at most ONE grant for its lifetime.
-- Unlike one-live-grant-per-command, this blocks replay even after a grant is
-- REVOKED or CONSUMED. A new request requires a new signed human review.
CREATE UNIQUE INDEX IF NOT EXISTS dev_gpt02_grants_review_one_time
 ON ai_platform.dev_gpt02_resume_grants(review_intent_id)
 WHERE review_intent_id IS NOT NULL;

-- Proposed append-only grant history. A terminal grant must never be
-- resurrected through UPDATE. APPROVED evidence binding is immutable, including
-- when revoking or consuming it. DELETE would defeat lifetime review uniqueness.
-- SECURITY INVOKER; this is NOT an issuer or a dispatch authorization.
CREATE OR REPLACE FUNCTION ai_platform.dev_gpt02_grant_transition_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,ai_platform AS $grant_guard$
BEGIN
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'GPT02_GRANT_DELETE_FORBIDDEN' USING ERRCODE='55000';
 END IF;
 IF OLD.status IN ('REVOKED','CONSUMED') THEN
  RAISE EXCEPTION 'GPT02_GRANT_TERMINAL_IMMUTABLE' USING ERRCODE='55000';
 END IF;
 IF OLD.status='APPROVED' THEN
  IF NEW.status NOT IN ('REVOKED','CONSUMED') THEN
   RAISE EXCEPTION 'GPT02_GRANT_APPROVED_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  IF (NEW.id,NEW.command_id,NEW.review_intent_id,NEW.operator_user_id,
      NEW.checkpoint_response_id,NEW.blocker_response_id,NEW.worker_id,
      NEW.approved_by,NEW.approved_at,NEW.expires_at,NEW.created_at)
   IS DISTINCT FROM
     (OLD.id,OLD.command_id,OLD.review_intent_id,OLD.operator_user_id,
      OLD.checkpoint_response_id,OLD.blocker_response_id,OLD.worker_id,
      OLD.approved_by,OLD.approved_at,OLD.expires_at,OLD.created_at) THEN
   RAISE EXCEPTION 'GPT02_GRANT_BINDING_IMMUTABLE' USING ERRCODE='55000';
  END IF;
 END IF;
 RETURN NEW;
END;
$grant_guard$;
REVOKE ALL ON FUNCTION ai_platform.dev_gpt02_grant_transition_guard()
 FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS dev_gpt02_grant_transition_guard_trg
 ON ai_platform.dev_gpt02_resume_grants;
CREATE TRIGGER dev_gpt02_grant_transition_guard_trg
 BEFORE UPDATE OR DELETE ON ai_platform.dev_gpt02_resume_grants
 FOR EACH ROW EXECUTE FUNCTION ai_platform.dev_gpt02_grant_transition_guard();

CREATE TABLE IF NOT EXISTS ai_platform.dev_gpt02_resume_command_leases (
  command_id uuid PRIMARY KEY REFERENCES ai_platform.ai_coding_bridge_commands(id),
  grant_id uuid NOT NULL REFERENCES ai_platform.dev_gpt02_resume_grants(id),
  worker_id text NOT NULL,
  fencing_version bigint NOT NULL CHECK (fencing_version >= 1),
  lease_token uuid NOT NULL UNIQUE,
  acquired_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > acquired_at),
  released_at timestamptz
);

-- Restrict public-facing roles even if schema exposure changes later.
ALTER TABLE ai_platform.dev_gpt02_resume_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.dev_gpt02_resume_command_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ai_platform.dev_gpt02_resume_grants FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ai_platform.dev_gpt02_resume_command_leases FROM PUBLIC, anon, authenticated;

-- SECURITY INVOKER: caller must possess explicit DB privileges. No role grants here.
-- Importantly the grant is locked FOR UPDATE, so two contenders serialize.
-- A failure to obtain the lease raises an exception and rolls back grant consumption.
-- Caller must still validate authenticated approval identity, checkpoint attestation,
-- matching BLOCKER, latest terminal event, rate limit & retry before calling.
CREATE OR REPLACE FUNCTION ai_platform.dev_gpt02_claim_resume(
  p_grant_id uuid,
  p_command_id uuid,
  p_blocker_response_id uuid,
  p_checkpoint_response_id uuid,
  p_worker_id text,
  p_lease_seconds integer
) RETURNS TABLE (grant_id uuid, command_id uuid, lease_token uuid, fencing_version bigint, lease_expires_at timestamptz)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, ai_platform
AS $$
DECLARE
  v_grant ai_platform.dev_gpt02_resume_grants%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_lease ai_platform.dev_gpt02_resume_command_leases%ROWTYPE;
BEGIN
  -- HARD NO-GO until trusted DB-side proof of native checkpoint attestation,
  -- latest BLOCKER, actor authorization, retries and circuit/429 clearance is wired.
  -- An approved grant row is insufficient to authorize resume.
  RAISE EXCEPTION 'RESUME_DISPATCH_GUARD_NOT_IMPLEMENTED' USING ERRCODE = '0A000';
  IF p_lease_seconds IS NULL OR p_lease_seconds < 10 OR p_lease_seconds > 300 OR
     p_grant_id IS NULL OR p_command_id IS NULL OR
     p_blocker_response_id IS NULL OR p_checkpoint_response_id IS NULL OR
     p_worker_id IS NULL OR length(trim(p_worker_id)) = 0 THEN
    RAISE EXCEPTION 'INVALID_RESUME_CLAIM' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_grant FROM ai_platform.dev_gpt02_resume_grants g
    WHERE g.id = p_grant_id FOR UPDATE;
  IF NOT FOUND OR v_grant.command_id IS DISTINCT FROM p_command_id OR
     v_grant.blocker_response_id IS DISTINCT FROM p_blocker_response_id OR
     v_grant.checkpoint_response_id IS DISTINCT FROM p_checkpoint_response_id OR
     v_grant.worker_id IS DISTINCT FROM p_worker_id OR
     v_grant.status IS DISTINCT FROM 'APPROVED' OR v_grant.consumed_at IS NOT NULL OR
     v_grant.approved_at IS NULL OR v_grant.approved_at > v_now OR
     v_grant.expires_at <= v_now THEN
    RAISE EXCEPTION 'RESUME_GRANT_NOT_ELIGIBLE' USING ERRCODE = 'P0001';
  END IF;

  -- A conflicting active lease causes zero returned rows; do NOT consume grant.
  INSERT INTO ai_platform.dev_gpt02_resume_command_leases AS l
      (command_id, grant_id, worker_id, fencing_version, lease_token, acquired_at, expires_at, released_at)
  VALUES (p_command_id, p_grant_id, p_worker_id, 1, gen_random_uuid(),
          v_now, v_now + make_interval(secs => p_lease_seconds), NULL)
  ON CONFLICT (command_id) DO UPDATE
    SET grant_id = EXCLUDED.grant_id, worker_id = EXCLUDED.worker_id,
        fencing_version = l.fencing_version + 1,
        lease_token = EXCLUDED.lease_token, acquired_at = EXCLUDED.acquired_at,
        expires_at = EXCLUDED.expires_at, released_at = NULL
    WHERE l.released_at IS NOT NULL OR l.expires_at <= v_now
  RETURNING * INTO v_lease;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMMAND_LEASE_BUSY' USING ERRCODE = '55P03';
  END IF;

  UPDATE ai_platform.dev_gpt02_resume_grants g
     SET consumed_at = v_now, status = 'CONSUMED'
     WHERE g.id = p_grant_id AND g.status = 'APPROVED' AND g.consumed_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GRANT_CONSUME_CONFLICT' USING ERRCODE = '40001';
  END IF;

  RETURN QUERY SELECT v_grant.id, p_command_id, v_lease.lease_token,
                      v_lease.fencing_version, v_lease.expires_at;
END;
$$;

-- Intentionally NO GRANT EXECUTE. Default PUBLIC function EXECUTE must be revoked.
REVOKE ALL ON FUNCTION ai_platform.dev_gpt02_claim_resume(uuid,uuid,uuid,uuid,text,integer) FROM PUBLIC;
-- A separate reviewed DEV migration must provision a narrowly scoped execution role.
-- Do not connect this function to live worker dispatch until PostgreSQL integration tests PASS.
