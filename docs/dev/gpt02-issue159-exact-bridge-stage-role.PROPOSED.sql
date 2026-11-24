-- DEV Issue159: review-only exact-command-ID HELD bridge staging proposal.
-- NOT APPLIED / NO CREDENTIALS / NO REAL DISPATCH / NEVER PROD.
-- Uses one SECURITY DEFINER function owned by the pre-existing private
-- store owner. Dedicated stage role has NO DIRECT INSERT/UPDATE/DELETE rights.
BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='20s';

DO $check$
BEGIN
 IF session_user<>'postgres' OR current_user<>'postgres'
 THEN RAISE EXCEPTION 'BRIDGE_STAGE_MIGRATOR_MISMATCH'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='dev_gpt02_bridge_stage_login')
 OR to_regprocedure('gpt02_private.stage_issue159_held_bridge_command(uuid,text)')
   IS NOT NULL
 THEN RAISE EXCEPTION 'BRIDGE_STAGE_ALREADY_PRESENT'; END IF;
 IF to_regclass('gpt02_private.positive_dispatch_outbox') IS NULL
 OR to_regclass('gpt02_private.positive_dispatch_consumptions') IS NULL
 OR to_regclass('gpt02_private.positive_dispatch_permits') IS NULL
 OR to_regclass('gpt02_stage.core_preparations') IS NULL
 OR to_regclass('ai_platform.ai_coding_tasks') IS NULL
 OR to_regclass('ai_platform.ai_coding_bridge_commands') IS NULL
 THEN RAISE EXCEPTION 'BRIDGE_STAGE_PREREQUISITES_MISSING'; END IF;
 IF pg_has_role('postgres','gpt02_store_owner','SET')
 THEN RAISE EXCEPTION 'BRIDGE_STAGE_STORE_OWNER_SET_DRIFT'; END IF;
 IF NOT has_table_privilege('gpt02_store_owner',
      'gpt02_stage.core_preparations','SELECT')
 THEN RAISE EXCEPTION 'BRIDGE_STAGE_EXISTING_CORE_PREP_READER_MISSING'; END IF;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='ai_platform'
       AND c.relname IN ('ai_coding_tasks','ai_coding_bridge_commands')
       AND c.relrowsecurity AND pg_get_userbyid(c.relowner)='postgres')<>2
 THEN RAISE EXCEPTION 'BRIDGE_STAGE_APP_RLS_OR_OWNER_DRIFT'; END IF;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='gpt02_private' AND c.relname IN
      ('positive_dispatch_outbox','positive_dispatch_consumptions','positive_dispatch_permits')
       AND c.relrowsecurity AND c.relforcerowsecurity
       AND pg_get_userbyid(c.relowner)='gpt02_store_owner')<>3
 THEN RAISE EXCEPTION 'BRIDGE_STAGE_PRIVATE_FORCE_RLS_DRIFT'; END IF;
END $check$;

CREATE ROLE dev_gpt02_bridge_stage_login
 NOLOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 0;

-- The existing table owner grants a narrowly scoped cross-schema insertion
-- ONLY to the gpt02 private ledger owner (NOLOGIN). Do not grant INSERT to
-- the bridge staging login, application role, service_role, anon or PUBLIC.
GRANT USAGE ON SCHEMA ai_platform TO gpt02_store_owner;
GRANT SELECT ON ai_platform.ai_coding_tasks TO gpt02_store_owner;
GRANT SELECT,INSERT ON ai_platform.ai_coding_bridge_commands
 TO gpt02_store_owner;

CREATE POLICY issue159_stage_core_task_select
 ON ai_platform.ai_coding_tasks FOR SELECT TO gpt02_store_owner
 USING(project_name='GPT02 DEV coding lifecycle'
       AND repository='Travelintrips/Core-AI-Foundation'
       AND branch='develop');
CREATE POLICY issue159_stage_bridge_select
 ON ai_platform.ai_coding_bridge_commands FOR SELECT TO gpt02_store_owner
 USING(source='ai-core' AND command_type='ISSUE159_HELD'
       AND metadata_json ? 'gpt02Issue159PositivePermit');
CREATE POLICY issue159_stage_bridge_insert
 ON ai_platform.ai_coding_bridge_commands FOR INSERT TO gpt02_store_owner
 WITH CHECK(
   source='ai-core' AND command_type='ISSUE159_HELD'
   AND status='RECEIVED' AND task_id IS NOT NULL
   AND authority_json='{}'::jsonb
   AND metadata_json ? 'gpt02Issue159PositivePermit'
   AND metadata_json->>'devOnly'='true'
   AND metadata_json->>'issue159Stage'='NO_DISPATCH'
   AND NOT (metadata_json ? 'assignedClientId')
 );

-- Exact marker uniqueness independent of original UUID/source unique keys.
CREATE UNIQUE INDEX issue159_stage_signed_command_marker_uidx
 ON ai_platform.ai_coding_bridge_commands
 ((metadata_json #>> '{gpt02Issue159PositivePermit,commandId}'))
 WHERE metadata_json ? 'gpt02Issue159PositivePermit'
   AND metadata_json #>> '{gpt02Issue159PositivePermit,commandId}' IS NOT NULL;

GRANT gpt02_store_owner TO postgres WITH SET TRUE;
SET ROLE gpt02_store_owner;
GRANT USAGE ON SCHEMA gpt02_private TO dev_gpt02_bridge_stage_login;

-- The store-owner body reads its own immutable outbox + consumed permit,
-- existing prep and pinned Core Task. No arbitrary instruction or target
-- is accepted from the caller. Existing worker notification is NOT invoked.
CREATE FUNCTION gpt02_private.stage_issue159_held_bridge_command(
 p_command uuid,p_packet_sha text
) RETURNS TABLE(
 stage_command_id text,stage_task_id text,stage_source text,
 stage_external_id text,stage_type text,stage_status text,
 stage_assignment text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF session_user<>'dev_gpt02_bridge_stage_login'
 OR p_packet_sha IS NULL OR p_packet_sha !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION USING ERRCODE='42501',
   MESSAGE='DEDICATED_STAGE_ROLE_AND_PACKET_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_command::text,0));
 RETURN QUERY
 INSERT INTO ai_platform.ai_coding_bridge_commands
  (id,task_id,external_command_id,source,command_type,instruction,
   authority_json,metadata_json,status)
 SELECT o.command_id,o.core_task_id,
        'gpt02-issue159:'||o.command_id::text,
        'ai-core','ISSUE159_HELD',c.instruction,
        '{}'::jsonb,
        jsonb_build_object(
          'gpt02Issue159PositivePermit',jsonb_build_object(
            'commandId',o.command_id::text,
            'attemptId',o.attempt_id::text,
            'permitId',o.permit_id::text,
            'deliveryState','HELD_NO_DISPATCH'),
          'devOnly',true,'issue159Stage','NO_DISPATCH'),
        'RECEIVED'
 FROM gpt02_private.positive_dispatch_outbox o
 JOIN gpt02_private.positive_dispatch_consumptions z
   ON z.permit_id=o.permit_id AND z.command_id=o.command_id
 JOIN gpt02_private.positive_dispatch_permits permit
   ON permit.permit_id=o.permit_id AND permit.command_id=o.command_id
 JOIN gpt02_stage.core_preparations prep
   ON prep.command_candidate_id=o.command_id
  AND prep.attempt_id=o.attempt_id
  AND prep.core_task_id=o.core_task_id
  AND prep.hub_task_id=o.hub_task_id
 JOIN ai_platform.ai_coding_tasks c ON c.id=prep.core_task_id
 WHERE o.command_id=p_command
   AND o.packet_sha256=p_packet_sha
   AND o.delivery_state='HELD_NO_DISPATCH'
   AND o.worker_id='openclaw-dell-chatgpt-wake-dev'
   AND permit.verified_packet_sha256=o.packet_sha256
   AND permit.expires_at>clock_timestamp()+interval '1 second'
   AND prep.company_id='default'
   AND prep.expires_at>clock_timestamp()+interval '1 second'
   AND c.project_name='GPT02 DEV coding lifecycle'
   AND c.repository='Travelintrips/Core-AI-Foundation'
   AND c.branch='develop' AND c.status='PENDING'
   AND c.task_number=('GPT02DEV-'||o.hub_task_id::text||'-'||substr(prep.config_sha256,1,14))
   AND length(c.instruction) BETWEEN 1 AND 2000
   AND c.instruction !~ '[[:cntrl:]]'
   AND NOT EXISTS (
     SELECT 1 FROM ai_platform.ai_coding_bridge_commands previous
     WHERE previous.id=o.command_id
       OR (previous.source='ai-core'
           AND previous.external_command_id='gpt02-issue159:'||o.command_id::text)
       OR (
         previous.metadata_json ? 'gpt02Issue159PositivePermit'
         AND previous.metadata_json->'gpt02Issue159PositivePermit'->>'commandId'
           =o.command_id::text)
   )
 RETURNING id::text,task_id::text,source,external_command_id,
           command_type,status,
           metadata_json->>'assignedClientId';
END $fn$;
REVOKE ALL ON FUNCTION
 gpt02_private.stage_issue159_held_bridge_command(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 gpt02_private.stage_issue159_held_bridge_command(uuid,text)
 TO dev_gpt02_bridge_stage_login;
RESET ROLE;
GRANT gpt02_store_owner TO postgres WITH SET FALSE;

DO $postflight$
BEGIN
 IF (SELECT rolcanlogin OR rolsuper OR rolbypassrls
       FROM pg_roles WHERE rolname='dev_gpt02_bridge_stage_login')
 OR (SELECT rolconnlimit FROM pg_roles
       WHERE rolname='dev_gpt02_bridge_stage_login')<>0
 OR pg_has_role('postgres','gpt02_store_owner','SET')
 OR has_table_privilege('dev_gpt02_bridge_stage_login',
      'ai_platform.ai_coding_bridge_commands','INSERT')
 OR has_table_privilege('dev_gpt02_bridge_stage_login',
      'ai_platform.ai_coding_bridge_commands','SELECT')
 OR has_table_privilege('dev_gpt02_bridge_stage_login',
      'gpt02_private.positive_dispatch_outbox','SELECT')
 OR NOT has_function_privilege('dev_gpt02_bridge_stage_login',
      'gpt02_private.stage_issue159_held_bridge_command(uuid,text)','EXECUTE')
 THEN RAISE EXCEPTION 'BRIDGE_STAGE_POSTFLIGHT_SECURITY_DRIFT'; END IF;
END $postflight$;
COMMIT;
