-- CST-DEV ONLY: GPT02_RELOCK_CST_DEV / project xssrfshdrtdfupgqwfdw.
-- Must be applied by the existing gpt02_relock_owner_approval_owner custody
-- through the authorized migration mechanism. Do not grant schema ownership,
-- runtime bypassrls, role SET privilege, or edit the production project.
--
-- Incident: 2026-11-24 07:01:30 UTC, approval POST HTTP 403; PostgreSQL
-- emitted GPT02_RELOCK_APPROVAL_DECISION_CHALLENGE_MISMATCH.
-- The approval transaction conditionally updates the challenge to CONSUMED
-- before inserting its decision. SELECT FOR KEY SHARE in the insert trigger
-- re-enters row-locking policy checks under FORCE RLS. The UPDATE policy's
-- USING only permits status PENDING; the just-consumed row can be invisible
-- during the trigger's redundant locking read.
-- The original UPDATE already holds the row lock until commit. This fix uses
-- a plain SELECT, preserving the SELECT policy, all matching checks, append-
-- only ledger, unique decision key, and atomic transaction.
--
-- Existing function owner must perform this change. Fail closed if not.
DO $custody$
BEGIN
  IF current_user <> 'gpt02_relock_owner_approval_owner' THEN
    RAISE EXCEPTION 'GPT02_OWNER_TRIGGER_MIGRATION_REQUIRES_SCHEMA_OWNER';
  END IF;
END
$custody$;

CREATE OR REPLACE FUNCTION gpt02_owner_approval.gpt02_relock_approval_decision_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'gpt02_owner_approval'
AS $function$
DECLARE challenge gpt02_owner_approval.gpt02_relock_owner_approval_challenges%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'GPT02_RELOCK_APPROVAL_DECISION_APPEND_ONLY';
  END IF;
  -- The transaction's conditional UPDATE holds the challenge row lock.
  -- Do not acquire a second row lock under the PENDING-only UPDATE RLS policy.
  SELECT * INTO challenge
    FROM gpt02_owner_approval.gpt02_relock_owner_approval_challenges
   WHERE id = NEW.challenge_id;
  IF NOT FOUND OR challenge.status <> 'CONSUMED'
     OR challenge.scope <> NEW.scope
     OR challenge.owner_subject <> NEW.owner_subject
     OR challenge.owner_auth_supabase_id <> NEW.owner_auth_supabase_id
     OR lower(challenge.owner_email) <> lower(NEW.owner_email)
     OR challenge.worker_principal <> NEW.worker_principal
     OR challenge.manifest_sha256 <> NEW.manifest_sha256
     OR challenge.environment <> 'DEV'
     OR challenge.project_id <> 'xssrfshdrtdfupgqwfdw'
     OR challenge.expires_at <= NEW.decided_at
     OR NEW.approval_method <> 'FRESH_CST_HUB_SIGNED_GOOGLE_OWNER_SESSION'
  THEN
    RAISE EXCEPTION 'GPT02_RELOCK_APPROVAL_DECISION_CHALLENGE_MISMATCH';
  END IF;
  RETURN NEW;
END
$function$;

-- Post-migration readback should show no FOR KEY SHARE in the guard function.
-- Never create an approval or manipulate an actual Owner challenge during QA.
