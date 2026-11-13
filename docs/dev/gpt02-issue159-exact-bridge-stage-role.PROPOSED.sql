-- DEV Issue159 only. PROPOSED, NOT APPLIED. NO credentials / NO dispatch.
-- Depends on reviewed positive permit/outbox proposal. Stage one held AI Core
-- bridge command using exact issuer UUID; never grant a worker claim/lease.
-- The database login role is CREATED NOLOGIN, CONNECTION LIMIT 0.
-- Independently approved credential provisioning is NOT included.
BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='20s';

DO $check$
BEGIN
 IF session_user<>'postgres' OR current_user<>'postgres'
 THEN RAISE EXCEPTION 'BRIDGE_STAGE_MIGRATOR_MISMATCH'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='dev_gpt02_bridge_stage_login')
 THEN RAISE EXCEPTION 'BRIDGE_STAGE_ROLE_ALREADY_PRESENT'; END IF;
 IF to_regclass('gpt02_private.positive_dispatch_outbox') IS NULL
 OR to_regclass('gpt02_private.positive_dispatch_consumptions') IS NULL
 OR to_regclass('gpt02_private.positive_dispatch_permits') IS NULL
 OR to_regclass('gpt02_stage.core_preparations') IS NULL
 OR to_regclass('ai_platform.ai_coding_tasks') IS NULL
 OR to_regclass('ai_platform.ai_coding_bridge_commands') IS NULL
 THEN RAISE EXCEPTION 'BRIDGE_STAGE_PREREQUISITES_MISSING'; END IF;
 IF pg_has_role('postgres','gpt02_store_owner','SET')
 OR pg_has_role('postgres','gpt02_core_prep_owner','SET')
 THEN RAISE EXCEPTION 'BRIDGE_STAGE_OWNER_SET_DRIFT'; END IF;
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

-- Existing outbox/permits/consumption: only bounded read-back, no mutation.
GRANT gpt02_store_owner TO postgres WITH SET TRUE;
SET ROLE gpt02_store_owner;
GRANT USAGE ON SCHEMA gpt02_private TO dev_gpt02_bridge_stage_login;
GRANT SELECT ON gpt02_private.positive_dispatch_outbox,
  gpt02_private.positive_dispatch_consumptions,
  gpt02_private.positive_dispatch_permits
 TO dev_gpt02_bridge_stage_login;
CREATE POLICY issue159_stage_outbox_select
 ON gpt02_private.positive_dispatch_outbox FOR SELECT
 TO dev_gpt02_bridge_stage_login
 USING(delivery_state='HELD_NO_DISPATCH'
       AND worker_id='openclaw-dell-chatgpt-wake-dev');
CREATE POLICY issue159_stage_consumed_select
 ON gpt02_private.positive_dispatch_consumptions FOR SELECT
 TO dev_gpt02_bridge_stage_login USING(true);
CREATE POLICY issue159_stage_permit_select
 ON gpt02_private.positive_dispatch_permits FOR SELECT
 TO dev_gpt02_bridge_stage_login USING(company_id='default');
RESET ROLE;
GRANT gpt02_store_owner TO postgres WITH SET FALSE;

-- Scoped immutable Core preparation read. Do not permit task creation.
GRANT gpt02_core_prep_owner TO postgres WITH SET TRUE;
SET ROLE gpt02_core_prep_owner;
GRANT USAGE ON SCHEMA gpt02_stage TO dev_gpt02_bridge_stage_login;
GRANT SELECT ON gpt02_stage.core_preparations
 TO dev_gpt02_bridge_stage_login;
CREATE POLICY issue159_stage_preparation_select
 ON gpt02_stage.core_preparations FOR SELECT
 TO dev_gpt02_bridge_stage_login
 USING(company_id='default' AND hub_task_id>139);
RESET ROLE;
GRANT gpt02_core_prep_owner TO postgres WITH SET FALSE;

-- The ai_platform table owner has explicit power to create these isolated
-- policies. No privilege is granted to the generic application role.
GRANT USAGE ON SCHEMA ai_platform TO dev_gpt02_bridge_stage_login;
GRANT SELECT ON ai_platform.ai_coding_tasks TO dev_gpt02_bridge_stage_login;
GRANT SELECT, INSERT ON ai_platform.ai_coding_bridge_commands
 TO dev_gpt02_bridge_stage_login;
CREATE POLICY issue159_stage_core_task_select
 ON ai_platform.ai_coding_tasks FOR SELECT
 TO dev_gpt02_bridge_stage_login
 USING(project_name='GPT02 DEV coding lifecycle'
   AND repository='Travelintrips/Core-AI-Foundation'
   AND branch='develop');
CREATE POLICY issue159_stage_bridge_select
 ON ai_platform.ai_coding_bridge_commands FOR SELECT
 TO dev_gpt02_bridge_stage_login
 USING(source='ai-core' AND command_type='ISSUE159_HELD'
   AND metadata_json ? 'gpt02Issue159PositivePermit');
CREATE POLICY issue159_stage_bridge_insert
 ON ai_platform.ai_coding_bridge_commands FOR INSERT
 TO dev_gpt02_bridge_stage_login
 WITH CHECK(
   source='ai-core' AND command_type='ISSUE159_HELD'
   AND status='RECEIVED'
   AND task_id IS NOT NULL
   AND authority_json='{}'::jsonb
   AND metadata_json ? 'gpt02Issue159PositivePermit'
   AND metadata_json->>'devOnly'='true'
   AND metadata_json->>'issue159Stage'='NO_DISPATCH'
   AND NOT (metadata_json ? 'assignedClientId')
 );

-- Existing (id) PK + (source, external_command_id) UNIQUE already protect
-- their own keys; add a unique marker key against alternative-source replay.
CREATE UNIQUE INDEX issue159_stage_signed_command_marker_uidx
 ON ai_platform.ai_coding_bridge_commands
 ((metadata_json #>> '{gpt02Issue159PositivePermit,commandId}'))
 WHERE metadata_json ? 'gpt02Issue159PositivePermit'
   AND metadata_json #>> '{gpt02Issue159PositivePermit,commandId}' IS NOT NULL;

DO $postflight$
BEGIN
 IF (SELECT rolcanlogin OR rolsuper OR rolbypassrls
       FROM pg_roles WHERE rolname='dev_gpt02_bridge_stage_login')
 OR (SELECT rolconnlimit FROM pg_roles
       WHERE rolname='dev_gpt02_bridge_stage_login')<>0
 OR pg_has_role('postgres','gpt02_store_owner','SET')
 OR pg_has_role('postgres','gpt02_core_prep_owner','SET')
 OR has_table_privilege('dev_gpt02_bridge_stage_login',
      'ai_platform.ai_coding_bridge_commands','UPDATE')
 OR has_table_privilege('dev_gpt02_bridge_stage_login',
      'ai_platform.ai_coding_bridge_commands','DELETE')
 OR has_table_privilege('dev_gpt02_bridge_stage_login',
      'gpt02_private.positive_dispatch_outbox','INSERT')
 THEN RAISE EXCEPTION 'BRIDGE_STAGE_POSTFLIGHT_SECURITY_DRIFT'; END IF;
END $postflight$;
COMMIT;
