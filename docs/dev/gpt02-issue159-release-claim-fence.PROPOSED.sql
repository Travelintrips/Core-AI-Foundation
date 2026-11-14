-- Issue159 DEV release claim: PROPOSED ONLY / NEVER APPLY TO PROD.
-- Adds an immutable, one-use DB fence BEFORE any gateway send.
-- This fence does not activate a signer, claim the generic worker, send a
-- command, acknowledge a callback, or authorize dispatch by itself.
-- Cryptographic verification of the independent signed release packet
-- MUST occur outside PostgreSQL with a pinned public key. Hashes passed
-- here are immutable audit bindings, not signature verification.
BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='20s';

DO $check$
BEGIN
 IF session_user<>'postgres' OR current_user<>'postgres'
 THEN RAISE EXCEPTION 'RELEASE_CLAIM_MIGRATOR_MISMATCH'; END IF;
 IF to_regclass('gpt02_private.issue159_release_claim_intents') IS NOT NULL
 OR to_regprocedure('gpt02_private.reserve_issue159_release_claim(uuid,uuid,text,text,text,text,text,uuid,text,text,bigint,bigint)') IS NOT NULL
 OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dev_gpt02_claim_gate_login')
 THEN RAISE EXCEPTION 'RELEASE_CLAIM_ALREADY_INSTALLED'; END IF;
 IF to_regclass('gpt02_private.positive_dispatch_outbox') IS NULL
 OR to_regclass('gpt02_private.positive_dispatch_consumptions') IS NULL
 OR to_regclass('gpt02_private.positive_dispatch_permits') IS NULL
 OR to_regprocedure('gpt02_private.stage_issue159_held_bridge_command(uuid,text)') IS NULL
 THEN RAISE EXCEPTION 'RELEASE_CLAIM_STAGE_OR_OUTBOX_MISSING'; END IF;
 IF pg_has_role('postgres','gpt02_store_owner','SET')
 THEN RAISE EXCEPTION 'RELEASE_CLAIM_OWNER_SET_DRIFT'; END IF;
 IF (SELECT pg_get_userbyid(nspowner) FROM pg_namespace
       WHERE nspname='extensions') IS DISTINCT FROM 'postgres'
 THEN RAISE EXCEPTION 'RELEASE_CLAIM_DIGEST_SCHEMA_OWNER_DRIFT'; END IF;
 IF NOT EXISTS(
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='ai_platform' AND c.relname='ai_settings'
      AND pg_get_userbyid(c.relowner)='postgres' AND c.relrowsecurity
 ) THEN RAISE EXCEPTION 'RELEASE_CLAIM_REGISTRY_OWNER_RLS_DRIFT'; END IF;
 IF NOT has_table_privilege('gpt02_store_owner',
       'ai_platform.ai_coding_bridge_commands','SELECT')
 OR NOT has_table_privilege('gpt02_store_owner',
       'ai_platform.ai_coding_tasks','SELECT')
 OR NOT has_table_privilege('gpt02_store_owner',
       'gpt02_stage.core_preparations','SELECT')
 THEN RAISE EXCEPTION 'RELEASE_CLAIM_TRUSTED_READS_NOT_READY'; END IF;
END $check$;

CREATE ROLE dev_gpt02_claim_gate_login
 NOLOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 0;
-- The private ledger owner must be able to compute SHA-256 from canonical
-- existing Core Task and issuer UUIDs. Only schema USAGE is added; digest()
-- EXECUTE is already available, and no public grant is broadened.
GRANT USAGE ON SCHEMA extensions TO gpt02_store_owner;
-- Reuse the existing central DEV GPT02 account-binding registry. Grant only
-- SELECT to the private NOLOGIN owner; RLS restricts it to two nonsecret
-- guardrail keys. A caller-supplied owner/target is never registry evidence.
GRANT SELECT ON ai_platform.ai_settings TO gpt02_store_owner;
CREATE POLICY issue159_release_registry_owner_select
 ON ai_platform.ai_settings FOR SELECT TO gpt02_store_owner
 USING(is_secret IS FALSE AND category='guardrail'
   AND key IN ('dev.chatgpt_wake.enabled',
               'dev.chatgpt_wake.account_bindings'));

GRANT gpt02_store_owner TO postgres WITH SET TRUE;
SET ROLE gpt02_store_owner;
GRANT USAGE ON SCHEMA gpt02_private TO dev_gpt02_claim_gate_login;

-- There is no mutable "SENT" state: an ambiguous gateway send must be
-- reconciled using the EXISTING gateway's read-only idempotency lookup,
-- never by deleting/releasing this one-use receipt.
CREATE TABLE gpt02_private.issue159_release_claim_intents (
 claim_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 command_id uuid NOT NULL UNIQUE,
 permit_id uuid NOT NULL UNIQUE,
 attempt_id uuid NOT NULL UNIQUE,
 core_task_id uuid NOT NULL UNIQUE,
 event_id text NOT NULL UNIQUE CHECK(event_id ~ '^[0-9a-f]{64}$'),
 challenge text NOT NULL UNIQUE CHECK(challenge ~ '^[0-9a-f]{64}$'),
 owner_channel text NOT NULL
   CHECK(owner_channel ~ '^ai-engine-oauth:[0-9a-f]{64}$'),
 target_conversation_id uuid NOT NULL,
 instruction_sha256 text NOT NULL
   CHECK(instruction_sha256 ~ '^[0-9a-f]{64}$'),
 packet_sha256 text NOT NULL
   CHECK(packet_sha256 ~ '^[0-9a-f]{64}$'),
 release_sha256 text NOT NULL UNIQUE
   CHECK(release_sha256 ~ '^[0-9a-f]{64}$'),
 release_signature_sha256 text NOT NULL
   CHECK(release_signature_sha256 ~ '^[0-9a-f]{64}$'),
 release_issued_at timestamptz NOT NULL,
 release_expires_at timestamptz NOT NULL,
 claim_state text NOT NULL DEFAULT 'RESERVED_NO_DISPATCH'
   CHECK(claim_state='RESERVED_NO_DISPATCH'),
 claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(command_id) REFERENCES gpt02_private.positive_dispatch_outbox(command_id),
 FOREIGN KEY(permit_id,command_id)
   REFERENCES gpt02_private.positive_dispatch_permits(permit_id,command_id)
);
ALTER TABLE gpt02_private.issue159_release_claim_intents
 ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.issue159_release_claim_intents
 FORCE ROW LEVEL SECURITY;
CREATE POLICY issue159_claim_owner ON gpt02_private.issue159_release_claim_intents
 FOR ALL TO gpt02_store_owner USING(true) WITH CHECK(true);
CREATE TRIGGER issue159_claim_immutable BEFORE UPDATE OR DELETE
 ON gpt02_private.issue159_release_claim_intents FOR EACH ROW
 EXECUTE FUNCTION gpt02_private.reject_mutation();
CREATE TRIGGER issue159_claim_no_truncate BEFORE TRUNCATE
 ON gpt02_private.issue159_release_claim_intents FOR EACH STATEMENT
 EXECUTE FUNCTION gpt02_private.reject_mutation();
REVOKE ALL ON gpt02_private.issue159_release_claim_intents
 FROM PUBLIC,anon,authenticated,service_role,dev_gpt02_claim_gate_login;

-- Only a dedicated role may reserve one HELD command/event. The caller
-- must already have validated a real independent signed release certificate
-- and trusted owner+target binding; this DB RPC cannot validate Ed25519.
CREATE FUNCTION gpt02_private.reserve_issue159_release_claim(
 p_command uuid,p_permit uuid,p_packet_sha text,
 p_release_sha text,p_release_signature_sha text,
 p_instruction_sha text,p_owner_channel text,p_target uuid,
 p_event text,p_challenge text,p_issued_ms bigint,p_expires_ms bigint
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog AS $fn$
DECLARE v record; v_claim uuid; v_now bigint;
        v_registry jsonb; v_registry_enabled text;
        v_matches integer; v_dell_count integer; v_target_count integer;
BEGIN
 IF session_user<>'dev_gpt02_claim_gate_login'
 OR p_packet_sha IS NULL OR p_packet_sha !~ '^[0-9a-f]{64}$'
 OR p_release_sha IS NULL OR p_release_sha !~ '^[0-9a-f]{64}$'
 OR p_release_signature_sha IS NULL
 OR p_release_signature_sha !~ '^[0-9a-f]{64}$'
 OR p_instruction_sha IS NULL OR p_instruction_sha !~ '^[0-9a-f]{64}$'
 OR p_owner_channel IS NULL
 OR p_owner_channel !~ '^ai-engine-oauth:[0-9a-f]{64}$'
 OR p_target IS NULL
 OR p_event IS NULL OR p_event !~ '^[0-9a-f]{64}$'
 OR p_challenge IS NULL OR p_challenge !~ '^[0-9a-f]{64}$'
 OR p_issued_ms IS NULL OR p_expires_ms IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='42501',
  MESSAGE='RELEASE_CLAIM_ROLE_AND_SIGNED_BINDING_REQUIRED'; END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(p_command::text,0));
 -- Exact owner + target MUST match the central registry, not caller JSON,
 -- and exactly one enabled GPT02 tuple may target the DELL worker. Existing
 -- other GPT02 workers are retained (no re-register or build from scratch).
 SELECT s.value::jsonb INTO v_registry
 FROM ai_platform.ai_settings s
 WHERE s.key='dev.chatgpt_wake.account_bindings'
   AND s.is_secret IS FALSE AND s.category='guardrail';
 SELECT s.value INTO v_registry_enabled
 FROM ai_platform.ai_settings s
 WHERE s.key='dev.chatgpt_wake.enabled'
   AND s.is_secret IS FALSE AND s.category='guardrail';
 IF v_registry_enabled IS DISTINCT FROM 'true'
 OR v_registry IS NULL OR jsonb_typeof(v_registry)<>'object'
 OR v_registry->>'version'<>'1'
 OR jsonb_typeof(v_registry->'bindings') IS DISTINCT FROM 'array'
 OR jsonb_array_length(v_registry->'bindings')>16
 THEN RAISE EXCEPTION USING ERRCODE='42501',
   MESSAGE='DEV_GPT02_TRUSTED_REGISTRY_NOT_READY'; END IF;
 SELECT
   count(*) FILTER(WHERE b->>'accountAlias'='GPT02'
     AND b->>'workerId'='openclaw-dell-chatgpt-wake-dev'
     AND b->>'ownerChannel'=p_owner_channel
     AND b->>'targetConversationId'=p_target::text
     AND jsonb_typeof(b->'enabled')='boolean'
     AND b->>'enabled'='true'
     AND (b->>'browserProfile') ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'),
   count(*) FILTER(WHERE b->>'accountAlias'='GPT02'
     AND b->>'workerId'='openclaw-dell-chatgpt-wake-dev'
     AND jsonb_typeof(b->'enabled')='boolean'
     AND b->>'enabled'='true'),
   count(*) FILTER(WHERE b->>'targetConversationId'=p_target::text
     AND jsonb_typeof(b->'enabled')='boolean'
     AND b->>'enabled'='true')
 INTO v_matches,v_dell_count,v_target_count
 FROM jsonb_array_elements(v_registry->'bindings') AS b;
 IF v_matches<>1 OR v_dell_count<>1 OR v_target_count<>1
 THEN RAISE EXCEPTION USING ERRCODE='42501',
   MESSAGE='DEV_GPT02_OWNER_TARGET_REGISTRY_MISMATCH'; END IF;
 v_now := floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF p_issued_ms>v_now OR p_issued_ms<v_now-15000
 OR p_expires_ms<=v_now+1000
 OR p_expires_ms>p_issued_ms+15000
 THEN RAISE EXCEPTION USING ERRCODE='42501',
  MESSAGE='RELEASE_CLAIM_EXPIRED_OR_UNBOUNDED'; END IF;

 SELECT o.command_id,o.permit_id,o.attempt_id,o.core_task_id,o.packet_sha256,
        permit.expires_at AS permit_expiry,
        prep.expires_at AS preparation_expiry,
        c.instruction AS core_instruction
 INTO v
 FROM gpt02_private.positive_dispatch_outbox o
 JOIN gpt02_private.positive_dispatch_consumptions consumed
   ON consumed.permit_id=o.permit_id AND consumed.command_id=o.command_id
 JOIN gpt02_private.positive_dispatch_permits permit
   ON permit.permit_id=o.permit_id AND permit.command_id=o.command_id
   AND permit.attempt_id=o.attempt_id
 JOIN gpt02_stage.core_preparations prep
   ON prep.command_candidate_id=o.command_id
   AND prep.attempt_id=o.attempt_id
   AND prep.core_task_id=o.core_task_id
   AND prep.hub_task_id=o.hub_task_id
   AND prep.company_id='default'
 JOIN ai_platform.ai_coding_tasks c
   ON c.id=o.core_task_id
 JOIN ai_platform.ai_coding_bridge_commands bridge
   ON bridge.id=o.command_id
   AND bridge.task_id=o.core_task_id
 WHERE o.command_id=p_command AND o.permit_id=p_permit
   AND o.packet_sha256=p_packet_sha
   AND o.delivery_state='HELD_NO_DISPATCH'
   AND o.worker_id='openclaw-dell-chatgpt-wake-dev'
   AND permit.worker_id=o.worker_id
   AND permit.company_id='default'
   AND c.project_name='GPT02 DEV coding lifecycle'
   AND c.repository='Travelintrips/Core-AI-Foundation'
   AND c.branch='develop' AND c.status='PENDING'
   AND c.task_number=('GPT02DEV-'||o.hub_task_id::text||'-'||substr(prep.config_sha256,1,14))
   AND bridge.source='ai-core' AND bridge.command_type='ISSUE159_HELD'
   AND bridge.status='RECEIVED'
   AND bridge.external_command_id='gpt02-issue159:'||o.command_id::text
   AND bridge.instruction=c.instruction
   AND bridge.authority_json='{}'::jsonb
   AND bridge.metadata_json->>'devOnly'='true'
   AND bridge.metadata_json->>'issue159Stage'='NO_DISPATCH'
   AND bridge.metadata_json->'gpt02Issue159PositivePermit'->>'commandId'=o.command_id::text
   AND bridge.metadata_json->'gpt02Issue159PositivePermit'->>'attemptId'=o.attempt_id::text
   AND bridge.metadata_json->'gpt02Issue159PositivePermit'->>'permitId'=o.permit_id::text
   AND bridge.metadata_json->'gpt02Issue159PositivePermit'->>'deliveryState'='HELD_NO_DISPATCH'
   AND NOT bridge.metadata_json ? 'assignedClientId'
 LIMIT 1;
 IF NOT FOUND
 THEN RAISE EXCEPTION USING ERRCODE='42501',
  MESSAGE='PERSISTED_HELD_COMMAND_NOT_PROVEN'; END IF;
 IF (v.permit_expiry<=clock_timestamp()+interval '1 second'
 OR v.preparation_expiry<=clock_timestamp()+interval '1 second'
 OR to_timestamp(p_expires_ms/1000.0) > LEAST(v.permit_expiry,v.preparation_expiry)
 OR encode(extensions.digest(v.core_instruction,'sha256'),'hex')<>p_instruction_sha
 OR p_event<>encode(extensions.digest(concat_ws(E'\n',
    'gpt02-issue159-event/v1',v.command_id::text,
    v.attempt_id::text,v.permit_id::text),'sha256'),'hex')
 OR p_challenge<>encode(extensions.digest(concat_ws(E'\n',
    'gpt02-issue159-challenge/v1',v.command_id::text,
    v.packet_sha256,p_target::text),'sha256'),'hex'))
 THEN RAISE EXCEPTION USING ERRCODE='42501',
  MESSAGE='RELEASE_CLAIM_SIGNED_CONTEXT_OR_LEASE_MISMATCH'; END IF;

 INSERT INTO gpt02_private.issue159_release_claim_intents
   (command_id,permit_id,attempt_id,core_task_id,event_id,challenge,
    owner_channel,target_conversation_id,instruction_sha256,
    packet_sha256,release_sha256,release_signature_sha256,
    release_issued_at,release_expires_at,claim_state)
 VALUES (v.command_id,v.permit_id,v.attempt_id,v.core_task_id,p_event,p_challenge,
         p_owner_channel,p_target,p_instruction_sha,p_packet_sha,
         p_release_sha,p_release_signature_sha,
         to_timestamp(p_issued_ms/1000.0),to_timestamp(p_expires_ms/1000.0),
         'RESERVED_NO_DISPATCH')
 RETURNING claim_id INTO v_claim;
 RETURN v_claim;
END $fn$;
REVOKE ALL ON FUNCTION
 gpt02_private.reserve_issue159_release_claim(
  uuid,uuid,text,text,text,text,text,uuid,text,text,bigint,bigint
 ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 gpt02_private.reserve_issue159_release_claim(
  uuid,uuid,text,text,text,text,text,uuid,text,text,bigint,bigint
 ) TO dev_gpt02_claim_gate_login;
-- After a lost response or crash, this is a READ-ONLY status hint.
-- It never authorizes a second send or turns a reservation into a lease.
CREATE FUNCTION gpt02_private.inspect_issue159_release_claim(
 p_command uuid,p_release_sha text,p_event text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $read$
BEGIN
 IF session_user<>'dev_gpt02_claim_gate_login'
 OR p_release_sha IS NULL OR p_release_sha !~ '^[0-9a-f]{64}$'
 OR p_event IS NULL OR p_event !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION USING ERRCODE='42501',
   MESSAGE='CLAIM_READBACK_TRUSTED_ROLE_REQUIRED'; END IF;
 IF EXISTS(
   SELECT 1 FROM gpt02_private.issue159_release_claim_intents x
   WHERE x.command_id=p_command AND x.release_sha256=p_release_sha
     AND x.event_id=p_event AND x.claim_state='RESERVED_NO_DISPATCH'
 ) THEN
   RETURN 'RECORDED_NO_DISPATCH_GATEWAY_LOOKUP_REQUIRED';
 END IF;
 RETURN 'NO_MATCHING_CLAIM_DO_NOT_SEND';
END $read$;
REVOKE ALL ON FUNCTION
 gpt02_private.inspect_issue159_release_claim(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 gpt02_private.inspect_issue159_release_claim(uuid,text,text)
 TO dev_gpt02_claim_gate_login;
RESET ROLE;
GRANT gpt02_store_owner TO postgres WITH SET FALSE;

DO $postflight$
BEGIN
 IF pg_has_role('postgres','gpt02_store_owner','SET')
 OR NOT has_schema_privilege('gpt02_store_owner','extensions','USAGE')
 OR NOT has_table_privilege('gpt02_store_owner',
      'ai_platform.ai_settings','SELECT')
 OR has_table_privilege('dev_gpt02_claim_gate_login',
      'ai_platform.ai_settings','SELECT')
 OR (SELECT rolcanlogin OR rolbypassrls OR rolsuper
       FROM pg_roles WHERE rolname='dev_gpt02_claim_gate_login')
 OR (SELECT rolconnlimit FROM pg_roles
       WHERE rolname='dev_gpt02_claim_gate_login')<>0
 OR has_table_privilege('dev_gpt02_claim_gate_login',
      'gpt02_private.issue159_release_claim_intents','INSERT')
 OR has_table_privilege('dev_gpt02_claim_gate_login',
      'gpt02_private.issue159_release_claim_intents','SELECT')
 OR NOT has_function_privilege('dev_gpt02_claim_gate_login',
      'gpt02_private.reserve_issue159_release_claim(uuid,uuid,text,text,text,text,text,uuid,text,text,bigint,bigint)','EXECUTE')
 OR NOT has_function_privilege('dev_gpt02_claim_gate_login',
      'gpt02_private.inspect_issue159_release_claim(uuid,text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'RELEASE_CLAIM_POSTFLIGHT_SECURITY_DRIFT'; END IF;
END $postflight$;
COMMIT;
