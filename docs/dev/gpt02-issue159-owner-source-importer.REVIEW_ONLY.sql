-- CST-DEV GPT02 Issue159 narrowly scoped Owner source transport: REVIEW ONLY.
-- Must be installed AFTER owner-source-fence-binding, never by a browser.
-- One Owner decision from SQLite is imported ONCE, BEFORE fourth issuer
-- proof. The one final scope link is registered AFTER the issuer signature.
-- No DB password, LOGIN, signer, worker, task, command, DELL or PROD action.
BEGIN;
DO $preflight$
BEGIN
 IF current_user<>'postgres'
 OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='postgres'
     AND rolcreaterole AND NOT rolsuper)
 OR to_regrole('dev_gpt02_owner_source_importer') IS NOT NULL
 OR to_regclass('gpt02_relock_audit.owner_source_decisions') IS NULL
 OR to_regclass('gpt02_relock_audit.reader_owner_source_bindings') IS NULL
 OR to_regclass('gpt02_relock_audit.reader_approval_fences') IS NULL
 OR to_regprocedure('gpt02_relock_audit.register_owner_source_once(uuid,text,text,text,integer,uuid,uuid,bigint,bigint)') IS NOT NULL
 THEN RAISE EXCEPTION 'OWNER_IMPORTER_ADD_ONLY_PREFLIGHT_DENIED'
   USING ERRCODE='42501'; END IF;
END $preflight$;
CREATE ROLE dev_gpt02_owner_source_importer
 NOLOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 0;
GRANT USAGE ON SCHEMA gpt02_relock_audit
 TO dev_gpt02_owner_source_importer;

-- Only a separately authorized, *briefly admitted* native importer role
-- can invoke this. It has NO direct INSERT/SELECT on any private tables.
-- The PostgreSQL function cannot independently verify a SQLite row or a
-- private key. The importer MUST first use the original Ed25519 approval
-- signature plus the existing root-owned Unix approval outbox reader.
CREATE FUNCTION gpt02_relock_audit.register_owner_source_once(
 p_decision uuid,p_claims_sha text,p_actor text,p_auth_method text,
 p_task integer,p_command uuid,p_attempt uuid,
 p_recorded_at_ms bigint,p_expires_at_ms bigint
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $owner$
DECLARE v_id uuid;v_now bigint;
BEGIN
 IF session_user<>'dev_gpt02_owner_source_importer'
 OR current_user<>'postgres'
 THEN RAISE EXCEPTION 'OWNER_SOURCE_IMPORTER_ROLE_REQUIRED'
  USING ERRCODE='42501'; END IF;
 v_now:=(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF p_task<=171
 OR p_claims_sha !~ '^[0-9a-f]{64}$'
 OR p_actor !~ '^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$'
 OR p_actor='dev_approval_token'
 OR p_auth_method NOT IN ('supabase_admin_session','supabase_aal2')
 OR p_expires_at_ms-v_now<3500
 OR p_recorded_at_ms<=0 OR p_recorded_at_ms>v_now
 OR p_expires_at_ms-p_recorded_at_ms>300000
 OR p_command=p_attempt
 THEN RAISE EXCEPTION 'OWNER_SOURCE_IMPORT_VALUES_INVALID'
   USING ERRCODE='22023'; END IF;
 INSERT INTO gpt02_relock_audit.owner_source_decisions
 (source_decision_id,claims_sha256,owner_actor_id,auth_method,
  role_at_decision,company_id,task_id,command_id,attempt_id,
  recorded_at_ms,expires_at_ms)
 VALUES (p_decision,p_claims_sha,p_actor,p_auth_method,'super_admin',
  'default',p_task,p_command,p_attempt,p_recorded_at_ms,p_expires_at_ms)
 ON CONFLICT DO NOTHING
 RETURNING source_decision_id INTO v_id;
 RETURN COALESCE(v_id=p_decision,FALSE);
END $owner$;
REVOKE ALL ON FUNCTION gpt02_relock_audit.register_owner_source_once(
 uuid,text,text,text,integer,uuid,uuid,bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gpt02_relock_audit.register_owner_source_once(
 uuid,text,text,text,integer,uuid,uuid,bigint,bigint)
 TO dev_gpt02_owner_source_importer;

CREATE FUNCTION gpt02_relock_audit.register_owner_scope_once(
 p_decision uuid,p_scope_sha text,p_packet_sha text
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $link$
DECLARE v_scope text;
BEGIN
 IF session_user<>'dev_gpt02_owner_source_importer'
 OR current_user<>'postgres'
 THEN RAISE EXCEPTION 'OWNER_SOURCE_IMPORTER_ROLE_REQUIRED'
    USING ERRCODE='42501'; END IF;
 IF p_scope_sha !~ '^[a-f0-9]{64}$'
 OR p_packet_sha !~ '^[a-f0-9]{64}$'
 THEN RAISE EXCEPTION 'OWNER_SOURCE_SCOPE_INVALID'
    USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM gpt02_relock_audit.owner_source_decisions s
 JOIN gpt02_relock_audit.reader_approval_fences f
   ON f.task_id=s.task_id AND f.company_id=s.company_id
   AND f.command_id=s.command_id AND f.attempt_id=s.attempt_id
 WHERE s.source_decision_id=p_decision AND f.scope_sha=p_scope_sha
   AND f.packet_sha=p_packet_sha
   AND s.revoked_at IS NULL AND f.revoked_at IS NULL
   AND to_timestamp(s.expires_at_ms/1000.0)>
     clock_timestamp()+interval '3.5 seconds'
   AND f.approval_expires_at<=to_timestamp(s.expires_at_ms/1000.0)
 FOR SHARE OF s,f;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'OWNER_SOURCE_OR_SCOPE_NOT_CURRENT'
     USING ERRCODE='42501'; END IF;
 INSERT INTO gpt02_relock_audit.reader_owner_source_bindings(
   scope_sha,source_decision_id,packet_sha)
 VALUES (p_scope_sha,p_decision,p_packet_sha)
 ON CONFLICT DO NOTHING
 RETURNING scope_sha INTO v_scope;
 RETURN COALESCE(v_scope=p_scope_sha,FALSE);
END $link$;
REVOKE ALL ON FUNCTION
 gpt02_relock_audit.register_owner_scope_once(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 gpt02_relock_audit.register_owner_scope_once(uuid,text,text)
 TO dev_gpt02_owner_source_importer;

-- Independent BOOLEAN-only readback (not an authority to issue). Existing
-- auditor may verify the COMMITTED Owner source and exact scope without
-- acquiring SELECT on the underlying private Owner/issuer tables.
CREATE FUNCTION gpt02_relock_audit.owner_source_persisted(
 p_decision uuid,p_claims_sha text,p_task integer,p_command uuid,
 p_attempt uuid,p_scope_sha text,p_packet_sha text
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $audit$
DECLARE v_good boolean;
BEGIN
 IF session_user<>'dev_gpt02_relock_catalog_auditor'
 OR current_user<>'postgres'
 THEN RAISE EXCEPTION 'OWNER_SOURCE_INDEPENDENT_AUDITOR_REQUIRED'
  USING ERRCODE='42501'; END IF;
 SELECT EXISTS (
  SELECT 1 FROM gpt02_relock_audit.owner_source_decisions s
  LEFT JOIN gpt02_relock_audit.reader_owner_source_bindings b
    ON b.source_decision_id=s.source_decision_id
  LEFT JOIN gpt02_relock_audit.reader_approval_fences f
    ON f.scope_sha=b.scope_sha
  WHERE s.source_decision_id=p_decision
    AND s.claims_sha256=p_claims_sha
    AND s.task_id=p_task AND s.command_id=p_command
    AND s.attempt_id=p_attempt AND s.revoked_at IS NULL
    AND to_timestamp(s.expires_at_ms/1000.0)>clock_timestamp()
    AND ((p_scope_sha IS NULL AND p_packet_sha IS NULL)
      OR (b.scope_sha=p_scope_sha AND b.packet_sha=p_packet_sha
          AND f.scope_sha=b.scope_sha AND f.packet_sha=b.packet_sha
          AND f.revoked_at IS NULL))
 ) INTO v_good;
 RETURN COALESCE(v_good,FALSE);
END $audit$;
REVOKE ALL ON FUNCTION gpt02_relock_audit.owner_source_persisted(
 uuid,text,integer,uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gpt02_relock_audit.owner_source_persisted(
 uuid,text,integer,uuid,uuid,text,text)
 TO dev_gpt02_relock_catalog_auditor;

DO $postflight$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles
    WHERE rolname='dev_gpt02_owner_source_importer'
    AND NOT rolcanlogin AND NOT rolinherit AND rolconnlimit=0
    AND NOT rolbypassrls AND NOT rolcreaterole)
 OR has_table_privilege('dev_gpt02_owner_source_importer',
    'gpt02_relock_audit.owner_source_decisions','INSERT')
 OR has_table_privilege('dev_gpt02_owner_source_importer',
    'gpt02_relock_audit.reader_owner_source_bindings','SELECT')
 THEN RAISE EXCEPTION 'OWNER_IMPORTER_ADD_ONLY_POSTFLIGHT_DENIED'
   USING ERRCODE='42501'; END IF;
END $postflight$;
COMMIT;
-- A valid native RPC call is NOT trusted consent without original
-- verified signature + committed SQLite outbox readback. Importer remains
-- NOLOGIN until short, independently authorized DEV custody is provisioned.
