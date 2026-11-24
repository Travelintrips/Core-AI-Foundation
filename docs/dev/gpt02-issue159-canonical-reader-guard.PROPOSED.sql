-- GPT02 Issue159 — SOURCE-ONLY, DRAFT canonical final reader admission guard.
-- UNINSTALLED. Never apply to live CST-DEV or PROD.
--
-- Depends on the EXISTING proposed same-PostgreSQL canonical approval fence,
-- one-read issuance, one-read consumption ledger, and 15-second TTL guard.
-- Does not migrate real SQLite approvals or create a credential issuer.
-- An actual live reader supervisor is UNIMPLEMENTED.
--
-- The original reader_consumption_persisted() boolean is historical only:
-- after a committed claim, it can return TRUE even if approval is revoked.
-- This proposal supplies a distinct, narrow guard that:
--   (a) checks current canonical approval and the committed read challenge;
--   (b) locks that canonical row FOR SHARE until the GUARD CONNECTION
--       explicitly COMMITs/ROLLBACKs its TRANSACTION;
--   (c) grants access only to one dormant admission-guard identity.
-- A BOOL TRUE returned in autocommit mode is NOT SAFE: the guard must hold
-- one explicit READ WRITE transaction across the entire bounded reader read.
-- This function itself does NOT open a reader session or grant authority.
-- Guard crash, lease expiry during SELECT, and socket/DB split-brain remain
-- independent release blockers even if this isolated SQL proves correct.

BEGIN;
DO $preflight$
BEGIN
 IF current_user <> 'postgres'
    OR NOT EXISTS (
      SELECT 1 FROM pg_roles WHERE rolname='postgres'
        AND rolcreaterole AND NOT rolsuper
    )
    OR NOT EXISTS (
      SELECT 1 FROM pg_namespace
      WHERE nspname='gpt02_relock_audit'
        AND nspowner='postgres'::regrole
    )
    OR (
      SELECT count(*) FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='gpt02_relock_audit'
        AND c.relname IN (
          'reader_approval_fences','reader_issuances','reader_consumptions'
        )
        AND c.relkind='r' AND c.relowner='postgres'::regrole
        AND c.relrowsecurity AND c.relforcerowsecurity
    ) <> 3
    OR to_regprocedure(
      'gpt02_relock_audit.reader_consumption_persisted(name,text,text,uuid,uuid,uuid,uuid,text)'
    ) IS NULL
    OR to_regprocedure(
      'gpt02_relock_audit.consume_reader_once(name,text,text,uuid,uuid,uuid,uuid,text)'
    ) IS NULL
    OR to_regprocedure(
      'gpt02_relock_audit.canonical_reader_current_guard(name,text,text,uuid,uuid,uuid,uuid,text)'
    ) IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM pg_roles
      WHERE rolname='dev_gpt02_reader_admission_guard'
    )
 THEN RAISE EXCEPTION 'CANONICAL_FINAL_READER_GUARD_PREFLIGHT_DENIED';
 END IF;
END $preflight$;

CREATE ROLE dev_gpt02_reader_admission_guard
 NOLOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 0;
GRANT USAGE ON SCHEMA gpt02_relock_audit
 TO dev_gpt02_reader_admission_guard;

CREATE FUNCTION gpt02_relock_audit.canonical_reader_current_guard(
 p_role name, p_scope_sha text, p_packet_sha text,
 p_command_id uuid, p_attempt_id uuid,
 p_receipt_id uuid, p_fence_id uuid, p_read_challenge text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $guard$
DECLARE v_match boolean;
BEGIN
 IF session_user <> 'dev_gpt02_reader_admission_guard'
    OR p_role::text !~ '^dev_gpt02_task_[1-9][0-9]*_[a-f0-9]{12}$'
    OR p_scope_sha !~ '^[a-f0-9]{64}$'
    OR p_packet_sha !~ '^[a-f0-9]{64}$'
    OR p_read_challenge !~ '^[a-f0-9]{64}$'
 THEN RAISE EXCEPTION 'CANONICAL_FINAL_READER_GUARD_CALLER_INVALID'
   USING ERRCODE='42501';
 END IF;

 -- RowShareLock + tuple FOR SHARE is held to END OF CALLER TRANSACTION.
 -- A concurrent canonical UPDATE/revoke must wait for guard's completion.
 SELECT TRUE INTO v_match
 FROM gpt02_relock_audit.reader_approval_fences f
 JOIN gpt02_relock_audit.reader_issuances i ON i.scope_sha=f.scope_sha
 JOIN gpt02_relock_audit.reader_consumptions c ON c.scope_sha=i.scope_sha
 WHERE f.scope_sha=p_scope_sha
   AND f.packet_sha=p_packet_sha
   AND f.role_name=p_role
   AND f.command_id=p_command_id
   AND f.attempt_id=p_attempt_id
   AND f.receipt_id=p_receipt_id
   AND f.fence_id=p_fence_id
   AND f.task_id=i.task_id AND f.company_id=i.company_id
   AND f.packet_sha=i.packet_sha AND f.role_name=i.role_name
   AND f.command_id=i.command_id AND f.attempt_id=i.attempt_id
   AND f.receipt_id=i.receipt_id AND f.fence_id=i.fence_id
   AND f.task_id>139 AND f.company_id='default'
   AND f.revoked_at IS NULL
   AND f.approval_expires_at>clock_timestamp()+interval '2 seconds'
   AND i.issued_at<=c.consumed_at
   AND c.consumed_at<i.expires_at
   AND i.expires_at>clock_timestamp()+interval '2 seconds'
   AND c.read_challenge=p_read_challenge
 FOR SHARE OF f;

 RETURN COALESCE(v_match,FALSE);
END
$guard$;

REVOKE ALL ON FUNCTION
 gpt02_relock_audit.canonical_reader_current_guard(
  name,text,text,uuid,uuid,uuid,uuid,text
 ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 gpt02_relock_audit.canonical_reader_current_guard(
  name,text,text,uuid,uuid,uuid,uuid,text
 ) TO dev_gpt02_reader_admission_guard;

DO $postflight$
BEGIN
 IF (SELECT rolcanlogin OR rolinherit OR rolsuper OR rolcreaterole
             OR rolbypassrls OR rolconnlimit<>0
      FROM pg_roles WHERE rolname='dev_gpt02_reader_admission_guard')
    OR has_table_privilege(
      'dev_gpt02_reader_admission_guard',
      'gpt02_relock_audit.reader_approval_fences','SELECT'
    )
    OR has_table_privilege(
      'dev_gpt02_reader_admission_guard',
      'gpt02_relock_audit.reader_issuances','SELECT'
    )
    OR has_table_privilege(
      'dev_gpt02_reader_admission_guard',
      'gpt02_relock_audit.reader_consumptions','SELECT'
    )
    OR has_function_privilege(
      'dev_gpt02_reader_claim_consumer',
      'gpt02_relock_audit.canonical_reader_current_guard(name,text,text,uuid,uuid,uuid,uuid,text)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'dev_gpt02_relock_catalog_auditor',
      'gpt02_relock_audit.canonical_reader_current_guard(name,text,text,uuid,uuid,uuid,uuid,text)',
      'EXECUTE'
    )
 THEN RAISE EXCEPTION 'CANONICAL_FINAL_READER_GUARD_PRIVILEGE_LEAK';
 END IF;
END $postflight$;
COMMIT;
-- NO LIVE READER, AUTHORIZATION, SIGNER OR FINAL ACK.
