-- GPT02 Issue159 SOURCE-ONLY DRAFT EXTENSION: NOT APPLIED TO DEV/PROD.
-- Depends on the existing approved-for-review ledger proposal:
--   gpt02-issue159-one-read-consumption-attestation.PROPOSED.sql
-- No service, credential, login, signer, dispatch or DELL call is created.
-- A separate, dormant caller gets EXECUTE on one bounded consumption RPC,
-- never direct READ/INSERT/UPDATE on the private issuance/consumption ledger.
-- SECURITY DEFINER privileges REQUIRE independent security review.
BEGIN;
DO $preflight$
BEGIN
 IF current_user <> 'postgres'
    OR NOT EXISTS (
      SELECT 1 FROM pg_roles WHERE rolname='postgres'
        AND rolcreaterole AND NOT rolsuper
    )
    OR NOT EXISTS (
      SELECT 1 FROM pg_namespace WHERE nspname='gpt02_relock_audit'
        AND nspowner='postgres'::regrole
    )
    OR to_regclass('gpt02_relock_audit.reader_issuances') IS NULL
    OR to_regclass('gpt02_relock_audit.reader_consumptions') IS NULL
    OR to_regprocedure(
      'gpt02_relock_audit.reader_consumption_persisted(name,text,text,uuid,uuid,uuid,uuid,text)'
    ) IS NULL
    OR to_regprocedure(
      'gpt02_relock_audit.consume_reader_once(name,text,text,uuid,uuid,uuid,uuid,text)'
    ) IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM pg_roles WHERE rolname='dev_gpt02_reader_claim_consumer'
    )
 THEN RAISE EXCEPTION 'ONE_READ_CONSUMER_PREFLIGHT_DENIED';
 END IF;
END $preflight$;

CREATE ROLE dev_gpt02_reader_claim_consumer
 NOLOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 0;
GRANT USAGE ON SCHEMA gpt02_relock_audit
 TO dev_gpt02_reader_claim_consumer;

-- The owner-signed issuance row, not caller-provided fields, is the only
-- authority for consuming a task. The caller supplies the exact scope,
-- packet, role, command, attempt, receipt, fence, and a fresh 256-bit
-- unpredictable challenge. An invalid, expired or already-consumed
-- claim returns FALSE. Concurrent requests cannot both insert: PK wins.
CREATE FUNCTION gpt02_relock_audit.consume_reader_once(
 p_role name, p_scope_sha text, p_packet_sha text,
 p_command_id uuid, p_attempt_id uuid,
 p_receipt_id uuid, p_fence_id uuid, p_read_challenge text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $consume_once$
DECLARE v_inserted text;
BEGIN
 IF session_user <> 'dev_gpt02_reader_claim_consumer'
    OR p_role::text !~ '^dev_gpt02_task_[1-9][0-9]*_[a-f0-9]{12}$'
    OR p_scope_sha !~ '^[0-9a-f]{64}$'
    OR p_packet_sha !~ '^[0-9a-f]{64}$'
    OR p_read_challenge !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'ONE_READ_CONSUMER_IDENTITY_OR_SCOPE_INVALID'
   USING ERRCODE='22023';
 END IF;

 INSERT INTO gpt02_relock_audit.reader_consumptions(
   scope_sha,read_challenge
 )
 SELECT i.scope_sha,p_read_challenge
 FROM gpt02_relock_audit.reader_issuances i
 WHERE i.scope_sha=p_scope_sha AND i.packet_sha=p_packet_sha
   AND i.role_name=p_role AND i.command_id=p_command_id
   AND i.attempt_id=p_attempt_id AND i.receipt_id=p_receipt_id
   AND i.fence_id=p_fence_id AND i.task_id>139
   AND i.company_id='default'
   AND i.expires_at>clock_timestamp()+interval '2 seconds'
 ON CONFLICT DO NOTHING
 RETURNING scope_sha INTO v_inserted;

 RETURN COALESCE(v_inserted=p_scope_sha,FALSE);
END
$consume_once$;

-- Neither PUBLIC, issuer/lineage reader, nor minimal auditor can consume.
REVOKE ALL ON FUNCTION
 gpt02_relock_audit.consume_reader_once(
  name,text,text,uuid,uuid,uuid,uuid,text
 ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 gpt02_relock_audit.consume_reader_once(
  name,text,text,uuid,uuid,uuid,uuid,text
 ) TO dev_gpt02_reader_claim_consumer;

DO $postflight$
BEGIN
 IF has_table_privilege(
      'dev_gpt02_reader_claim_consumer',
      'gpt02_relock_audit.reader_issuances','SELECT'
    )
    OR has_table_privilege(
      'dev_gpt02_reader_claim_consumer',
      'gpt02_relock_audit.reader_consumptions','INSERT'
    )
    OR has_schema_privilege(
      'dev_gpt02_reader_claim_consumer','gpt02_private','USAGE'
    )
    OR (SELECT rolcanlogin OR rolinherit OR rolcreaterole
        OR rolbypassrls OR rolconnlimit<>0
        FROM pg_roles
        WHERE rolname='dev_gpt02_reader_claim_consumer')
    OR has_function_privilege(
      'dev_gpt02_relock_catalog_auditor',
      'gpt02_relock_audit.consume_reader_once(name,text,text,uuid,uuid,uuid,uuid,text)',
      'EXECUTE'
    )
 THEN RAISE EXCEPTION 'ONE_READ_CONSUMER_PRIVILEGE_LEAK';
 END IF;
END $postflight$;
COMMIT;
-- End review-only proposal. No live activation.
