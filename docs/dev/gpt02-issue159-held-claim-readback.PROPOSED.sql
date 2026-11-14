-- DEV Issue159 HELD readback. PROPOSED ONLY, depends on preceding
-- positive-permit, held-staging and release-claim proposal migrations.
-- No LOGIN activation, no worker command, no issuer grant, no PROD changes.
BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='20s';
DO $pre$
BEGIN
 IF session_user<>'postgres' OR current_user<>'postgres'
 OR pg_has_role('postgres','gpt02_store_owner','SET')
 OR to_regprocedure('gpt02_private.read_issue159_held_for_claim(uuid,uuid,text)') IS NOT NULL
 OR to_regclass('gpt02_private.positive_dispatch_outbox') IS NULL
 OR to_regprocedure('gpt02_private.reserve_issue159_release_claim(uuid,uuid,text,text,text,text,text,uuid,text,text,bigint,bigint)') IS NULL
 THEN RAISE EXCEPTION 'HELD_READBACK_PRECONDITION_FAILED'; END IF;
END $pre$;
GRANT gpt02_store_owner TO postgres WITH SET TRUE;
SET ROLE gpt02_store_owner;
CREATE FUNCTION gpt02_private.read_issue159_held_for_claim(
 p_command uuid,p_permit uuid,p_packet_sha text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE v jsonb;
BEGIN
 IF session_user<>'dev_gpt02_claim_gate_login'
 OR p_command IS NULL OR p_permit IS NULL
 OR p_packet_sha IS NULL OR p_packet_sha !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION USING ERRCODE='42501',
   MESSAGE='TRUSTED_HELD_READBACK_ROLE_REQUIRED'; END IF;
 SELECT jsonb_build_object(
    'id',b.id::text,'taskId',b.task_id::text,
    'source',b.source,'commandType',b.command_type,
    'status',b.status,'externalCommandId',b.external_command_id,
    'instruction',b.instruction,'metadata',b.metadata_json)
 INTO v
 FROM gpt02_private.positive_dispatch_outbox o
 JOIN gpt02_private.positive_dispatch_consumptions c
   ON c.command_id=o.command_id AND c.permit_id=o.permit_id
 JOIN gpt02_private.positive_dispatch_permits p
   ON p.command_id=o.command_id AND p.permit_id=o.permit_id
 JOIN gpt02_stage.core_preparations prep
   ON prep.command_candidate_id=o.command_id
   AND prep.attempt_id=o.attempt_id AND prep.core_task_id=o.core_task_id
   AND prep.hub_task_id=o.hub_task_id AND prep.company_id='default'
 JOIN ai_platform.ai_coding_tasks t ON t.id=prep.core_task_id
 JOIN ai_platform.ai_coding_bridge_commands b
   ON b.id=o.command_id AND b.task_id=o.core_task_id
 WHERE o.command_id=p_command AND o.permit_id=p_permit
   AND o.packet_sha256=p_packet_sha
   AND o.delivery_state='HELD_NO_DISPATCH'
   AND o.worker_id='openclaw-dell-chatgpt-wake-dev'
   AND p.company_id='default'
   AND p.attempt_id=o.attempt_id
   AND p.verified_packet_sha256=o.packet_sha256
   AND p.expires_at>clock_timestamp()+interval '1 second'
   AND prep.expires_at>clock_timestamp()+interval '1 second'
   AND t.status='PENDING' AND t.instruction=b.instruction
   AND t.project_name='GPT02 DEV coding lifecycle'
   AND t.repository='Travelintrips/Core-AI-Foundation'
   AND t.branch='develop'
   AND t.task_number=('GPT02DEV-'||o.hub_task_id::text||'-'||substr(prep.config_sha256,1,14))
   AND b.source='ai-core' AND b.command_type='ISSUE159_HELD'
   AND b.status='RECEIVED'
   AND b.external_command_id='gpt02-issue159:'||o.command_id::text
   AND b.authority_json='{}'::jsonb
   AND b.metadata_json->>'devOnly'='true'
   AND b.metadata_json->>'issue159Stage'='NO_DISPATCH'
   AND b.metadata_json->'gpt02Issue159PositivePermit'->>'commandId'=o.command_id::text
   AND b.metadata_json->'gpt02Issue159PositivePermit'->>'attemptId'=o.attempt_id::text
   AND b.metadata_json->'gpt02Issue159PositivePermit'->>'permitId'=o.permit_id::text
   AND b.metadata_json->'gpt02Issue159PositivePermit'->>'deliveryState'='HELD_NO_DISPATCH'
   AND NOT b.metadata_json ? 'assignedClientId'
 LIMIT 1;
 IF v IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',
   MESSAGE='PERSISTED_HELD_CLAIM_READBACK_UNAVAILABLE'; END IF;
 RETURN v;
END $fn$;
REVOKE ALL ON FUNCTION
 gpt02_private.read_issue159_held_for_claim(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 gpt02_private.read_issue159_held_for_claim(uuid,uuid,text)
 TO dev_gpt02_claim_gate_login;
RESET ROLE;
GRANT gpt02_store_owner TO postgres WITH SET FALSE;
DO $post$
BEGIN
 IF pg_has_role('postgres','gpt02_store_owner','SET')
 OR NOT has_function_privilege('dev_gpt02_claim_gate_login',
   'gpt02_private.read_issue159_held_for_claim(uuid,uuid,text)','EXECUTE')
 OR has_table_privilege('dev_gpt02_claim_gate_login',
   'ai_platform.ai_coding_bridge_commands','SELECT')
 OR has_table_privilege('dev_gpt02_claim_gate_login',
   'gpt02_private.positive_dispatch_outbox','SELECT')
 THEN RAISE EXCEPTION 'HELD_READBACK_POSTFLIGHT_SECURITY_DRIFT'; END IF;
END $post$;
COMMIT;
