-- Read-only catalog verification. No DDL, DML, grants, task creation or dispatch.
-- Run under a scoped database role; an error indicates NO-GO.
DO $guard$
DECLARE
 rel oid := to_regclass('ai_platform.dev_gpt02_task_attempt_binding_claims');
 missing text;
 trigger_count integer;
 unsafe_grants integer;
 expected text[]:=ARRAY[
  'claim_core_command_once','claim_hub_execution_once','claim_attempt_once',
  'claim_task_attempt_once','claim_evidence_digest_once',
  'dev_gpt02_task_attempt_binding_claims_pkey','claim_nonce_provenance_tuple_once'];
BEGIN
 IF rel IS NULL THEN RAISE EXCEPTION 'GPT02_BINDING_TABLE_MISSING' USING ERRCODE='55000'; END IF;
 SELECT string_agg(x,',') INTO missing FROM unnest(expected) AS x
 WHERE NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=rel AND c.conname=x AND c.contype IN ('u','p')
 );
 IF missing IS NOT NULL THEN RAISE EXCEPTION 'GPT02_BINDING_UNIQUENESS_DRIFT: %',missing USING ERRCODE='55000'; END IF;
 SELECT count(*) INTO trigger_count FROM pg_catalog.pg_trigger t
 WHERE t.tgrelid=rel AND t.tgname='dev_gpt02_task_binding_immutable_trg'
 AND NOT t.tgisinternal AND t.tgenabled='O'
 AND (t.tgtype & 1)=1 AND (t.tgtype & 16)=16 AND (t.tgtype & 8)=8
 AND t.tgfoid='ai_platform.dev_gpt02_task_binding_immutable()'::regprocedure;
 IF trigger_count<>1 THEN RAISE EXCEPTION 'GPT02_BINDING_IMMUTABILITY_TRIGGER_DRIFT' USING ERRCODE='55000'; END IF;
 -- An active trigger is useless if somebody replaces its function with RETURN NEW.
 -- Verify its effective definition, not merely the trigger name or enabled flag.
 IF NOT pg_get_functiondef('ai_platform.dev_gpt02_task_binding_immutable()'::regprocedure)
  LIKE '%RAISE EXCEPTION ''GPT02_TASK_BINDING_IMMUTABLE''%'
  OR pg_get_functiondef('ai_platform.dev_gpt02_task_binding_immutable()'::regprocedure) ~* 'RETURN[[:space:]]+NEW' THEN
  RAISE EXCEPTION 'GPT02_BINDING_TRIGGER_FUNCTION_DRIFT' USING ERRCODE='55000'; END IF;
 -- A recorded actor must be the same operator ID bound into nonce provenance.
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=rel
  AND c.contype='c' AND c.convalidated AND c.conname='claim_recorded_by_operator_identity'
  AND pg_get_constraintdef(c.oid) LIKE '%operator_user_id%') THEN
  RAISE EXCEPTION 'GPT02_BINDING_OPERATOR_IDENTITY_DRIFT' USING ERRCODE='55000'; END IF;
 -- Check hardcoded authority-denial constraints still actually exist and are validated.
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=rel AND c.contype='c'
  AND c.convalidated AND pg_get_constraintdef(c.oid) LIKE '%binding_verified = false%') THEN
  RAISE EXCEPTION 'GPT02_BINDING_SELF_ATTESTATION_GUARD_DRIFT' USING ERRCODE='55000'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=rel AND c.contype='c'
  AND c.convalidated AND pg_get_constraintdef(c.oid) LIKE '%may_dispatch_worker = false%') THEN
  RAISE EXCEPTION 'GPT02_BINDING_DISPATCH_GUARD_DRIFT' USING ERRCODE='55000'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=rel AND c.contype='c'
  AND c.convalidated AND pg_get_constraintdef(c.oid) LIKE '%may_close_job = false%') THEN
  RAISE EXCEPTION 'GPT02_BINDING_CLOSE_GUARD_DRIFT' USING ERRCODE='55000'; END IF;
 SELECT count(*) INTO unsafe_grants FROM pg_catalog.pg_class cl
 JOIN pg_catalog.pg_namespace ns ON ns.oid=cl.relnamespace
 CROSS JOIN LATERAL aclexplode(COALESCE(cl.relacl,acldefault('r',cl.relowner))) a
 WHERE cl.oid=rel AND a.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')
  AND a.grantee IS DISTINCT FROM cl.relowner;
 IF unsafe_grants>0 THEN RAISE EXCEPTION 'GPT02_BINDING_UNAUTHORIZED_WRITE_GRANT_DRIFT' USING ERRCODE='55000'; END IF;
 RAISE NOTICE 'GPT02_BINDING_SCHEMA_DRIFT_GUARD_PASS';
END;
$guard$;
