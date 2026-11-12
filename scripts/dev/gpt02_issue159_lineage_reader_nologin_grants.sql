-- CST-DEV only: staged dedicated lineage reader privileges.
-- This role is NOLOGIN and cannot connect until independently reviewed credential
-- activation. Never use the existing issuer reader login or signer credentials.
-- Never run on PROD.
BEGIN;
-- Temporary owner SET permission used only inside this transaction.
-- Based on Supabase documented custom-role administration; revoke before COMMIT.
GRANT gpt02_store_owner TO postgres WITH SET TRUE, INHERIT FALSE;
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='gpt02_store_owner')
 OR NOT pg_catalog.pg_has_role(current_user,'gpt02_store_owner','SET') THEN
   RAISE EXCEPTION 'STORE_OWNER_SET_PRIVILEGE_REQUIRED_FOR_RLS_POLICY';
 END IF;
END $$;
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'dev_gpt02_lineage_reader') THEN
   RAISE EXCEPTION 'LINEAGE_READER_ROLE_ALREADY_EXISTS_REVIEW_FIRST';
 END IF;
 CREATE ROLE dev_gpt02_lineage_reader
   NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
   NOINHERIT NOREPLICATION NOBYPASSRLS;
END $$;

SET ROLE gpt02_store_owner;
GRANT USAGE ON SCHEMA gpt02_private TO dev_gpt02_lineage_reader;

GRANT SELECT (
 task_id,company_id,attempt_id,command_id,digest,nonce,expires_at
) ON gpt02_private.approvals TO dev_gpt02_lineage_reader;
GRANT SELECT (
 link_id,command_id,attempt_id,company_id,hub_task_id,approval_digest,
 hub_execution_id,core_task_id,link_digest,expires_at
) ON gpt02_private.operator_links TO dev_gpt02_lineage_reader;
GRANT SELECT (
 id,command_id,nonce,digest,consumed_at
) ON gpt02_private.receipts TO dev_gpt02_lineage_reader;
GRANT SELECT (
 receipt_id,command_id,link_id,link_digest,binding_verified,
 may_dispatch_worker,may_issue_grant,may_close_job,core_ledger_written
) ON gpt02_private.core_identity_receipts TO dev_gpt02_lineage_reader;
GRANT SELECT (
 fence_id,receipt_id,command_id,link_id,attempt_id,hub_execution_id,
 core_task_id,worker_id,lease_epoch,lease_started_at,lease_expires_at,
 dispatch_allowed,core_ledger_written
) ON gpt02_private.post_consumption_fences TO dev_gpt02_lineage_reader;

CREATE POLICY dev_gpt02_lineage_reader_select
ON gpt02_private.approvals FOR SELECT TO dev_gpt02_lineage_reader
USING (company_id='default' AND task_id>139 AND claims->>'environment'='DEV');
CREATE POLICY dev_gpt02_lineage_reader_select
ON gpt02_private.operator_links FOR SELECT TO dev_gpt02_lineage_reader
USING (company_id='default' AND hub_task_id>139
 AND attempt_number=1 AND claims->>'environment'='DEV');
CREATE POLICY dev_gpt02_lineage_reader_select
ON gpt02_private.receipts FOR SELECT TO dev_gpt02_lineage_reader
USING (true);
CREATE POLICY dev_gpt02_lineage_reader_select
ON gpt02_private.core_identity_receipts FOR SELECT TO dev_gpt02_lineage_reader
USING (NOT binding_verified AND NOT may_dispatch_worker
 AND NOT may_issue_grant AND NOT may_close_job AND NOT core_ledger_written);
CREATE POLICY dev_gpt02_lineage_reader_select
ON gpt02_private.post_consumption_fences FOR SELECT TO dev_gpt02_lineage_reader
USING (worker_id='openclaw-dell-chatgpt-wake-dev'
 AND lease_epoch=1 AND NOT dispatch_allowed AND NOT core_ledger_written);
RESET ROLE;
REVOKE gpt02_store_owner FROM postgres;
DO $restore_guard$
BEGIN
 IF pg_catalog.pg_has_role('postgres','gpt02_store_owner','SET') THEN
   RAISE EXCEPTION 'TEMPORARY_OWNER_SET_NOT_REVOKED';
 END IF;
END $restore_guard$;
COMMIT;

-- Expected: role NOLOGIN/NOBYPASSRLS, five FORCE RLS tables,
-- only needed column SELECT grants, zero DML, no RPC EXECUTE,
-- no LOGIN credential, no public schema/Data API exposure.
