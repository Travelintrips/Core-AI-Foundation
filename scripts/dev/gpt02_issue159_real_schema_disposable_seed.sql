-- Disposable-only replica of GPT02 Stage/Private column and owner contracts.
-- NEVER use this seed on live DEV or PROD.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE gpt02_core_prep_login NOLOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 0;
CREATE ROLE gpt02_core_prep_owner NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE gpt02_store_owner NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE SCHEMA gpt02_stage AUTHORIZATION gpt02_core_prep_owner;
CREATE SCHEMA gpt02_private AUTHORIZATION gpt02_store_owner;
CREATE SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

SET ROLE gpt02_core_prep_owner;
CREATE TABLE gpt02_stage.core_preparations (
 company_id text NOT NULL, hub_task_id integer NOT NULL,
 member_id integer NOT NULL, member_audit_id integer NOT NULL,
 operator_subject text NOT NULL, core_task_id uuid NOT NULL UNIQUE,
 hub_execution_id uuid NOT NULL UNIQUE, command_candidate_id uuid NOT NULL UNIQUE,
 attempt_id uuid NOT NULL UNIQUE, config_sha256 text NOT NULL,
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(company_id,hub_task_id)
);
ALTER TABLE gpt02_stage.core_preparations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_stage.core_preparations FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON gpt02_stage.core_preparations
 FOR ALL TO gpt02_core_prep_owner USING(true) WITH CHECK(true);
CREATE OR REPLACE FUNCTION gpt02_stage.prepare_core_task_dormant(
 p_company text,p_task integer,p_project text,p_repo text,p_branch text,p_instruction text)
RETURNS TABLE(core_task_id uuid,command_candidate_id uuid,attempt_id uuid,
 hub_execution_id uuid,created boolean,dispatch_permitted boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN RAISE EXCEPTION 'SYNTHETIC_PREPARER_DISABLED'; END $fn$;
REVOKE ALL ON FUNCTION gpt02_stage.prepare_core_task_dormant(
 text,integer,text,text,text,text) FROM PUBLIC;
RESET ROLE;

SET ROLE gpt02_store_owner;
CREATE OR REPLACE FUNCTION gpt02_private.reject_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $fn$
BEGIN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='APPEND_ONLY_EVIDENCE';END $fn$;
REVOKE ALL ON FUNCTION gpt02_private.reject_mutation() FROM PUBLIC;
CREATE TABLE gpt02_private.approvals(
 command_id uuid PRIMARY KEY, attempt_id uuid NOT NULL UNIQUE,
 nonce text NOT NULL UNIQUE,task_id integer NOT NULL CHECK(task_id>136),
 company_id text NOT NULL,approver_id text NOT NULL,
 claims jsonb NOT NULL,signature text NOT NULL CHECK(signature ~ '^[A-Za-z0-9_-]{86}$'),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 expires_at timestamptz NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 operator_namespace text NOT NULL CHECK(operator_namespace='ai-task-hub.public.users'),
 CHECK(command_id<>attempt_id)
);
CREATE TABLE gpt02_private.operator_links(
 link_id uuid PRIMARY KEY,command_id uuid NOT NULL UNIQUE REFERENCES gpt02_private.approvals(command_id),
 hub_execution_id uuid NOT NULL UNIQUE,core_task_id uuid NOT NULL,
 hub_task_id integer NOT NULL CHECK(hub_task_id>136),attempt_id uuid NOT NULL UNIQUE,
 attempt_number integer NOT NULL CHECK(attempt_number=1),
 company_id text NOT NULL CHECK(company_id='default'),
 assignee_id integer NOT NULL CHECK(assignee_id>0),
 accountable_owner_id text NOT NULL,hub_operator_id text NOT NULL,
 core_operator_user_id integer NOT NULL CHECK(core_operator_user_id>0),
 approval_digest text NOT NULL CHECK(approval_digest ~ '^[0-9a-f]{64}$'),
 link_digest text NOT NULL UNIQUE CHECK(link_digest ~ '^[0-9a-f]{64}$'),
 hub_signature text NOT NULL CHECK(hub_signature ~ '^[A-Za-z0-9_-]{86}$'),
 core_signature text NOT NULL CHECK(core_signature ~ '^[A-Za-z0-9_-]{86}$'),
 claims jsonb NOT NULL,expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,hub_task_id,attempt_number),
 UNIQUE(link_id,command_id,core_operator_user_id,hub_operator_id,link_digest)
);
CREATE TABLE gpt02_private.receipts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),command_id uuid NOT NULL UNIQUE REFERENCES gpt02_private.approvals(command_id),
 nonce text NOT NULL UNIQUE,digest text NOT NULL,
 consumed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(id,command_id)
);
CREATE TABLE gpt02_private.core_identity_receipts(
 receipt_id uuid PRIMARY KEY,command_id uuid NOT NULL UNIQUE,link_id uuid NOT NULL UNIQUE,
 operator_user_id integer NOT NULL CHECK(operator_user_id>0),
 recorded_by text NOT NULL CHECK(recorded_by='internal:'||operator_user_id::text),
 hub_operator_id text NOT NULL,link_digest text NOT NULL,
 binding_verified boolean NOT NULL DEFAULT false CHECK(binding_verified=false),
 may_dispatch_worker boolean NOT NULL DEFAULT false CHECK(may_dispatch_worker=false),
 may_close_job boolean NOT NULL DEFAULT false CHECK(may_close_job=false),
 may_issue_grant boolean NOT NULL DEFAULT false CHECK(may_issue_grant=false),
 core_ledger_written boolean NOT NULL DEFAULT false CHECK(core_ledger_written=false),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(receipt_id,command_id) REFERENCES gpt02_private.receipts(id,command_id),
 FOREIGN KEY(link_id,command_id,operator_user_id,hub_operator_id,link_digest)
 REFERENCES gpt02_private.operator_links(link_id,command_id,core_operator_user_id,hub_operator_id,link_digest)
);
CREATE TABLE gpt02_private.post_consumption_fences(
 fence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 receipt_id uuid NOT NULL UNIQUE REFERENCES gpt02_private.core_identity_receipts(receipt_id),
 command_id uuid NOT NULL UNIQUE REFERENCES gpt02_private.receipts(command_id),
 link_id uuid NOT NULL UNIQUE REFERENCES gpt02_private.operator_links(link_id),
 hub_execution_id uuid NOT NULL UNIQUE,core_task_id uuid NOT NULL,
 attempt_id uuid NOT NULL UNIQUE,
 worker_id text NOT NULL CHECK(worker_id='openclaw-dell-chatgpt-wake-dev'),
 lease_epoch bigint NOT NULL DEFAULT 1 CHECK(lease_epoch=1),
 lease_started_at timestamptz NOT NULL,lease_expires_at timestamptz NOT NULL,
 dispatch_allowed boolean NOT NULL DEFAULT false CHECK(dispatch_allowed=false),
 core_ledger_written boolean NOT NULL DEFAULT false CHECK(core_ledger_written=false),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(lease_expires_at>lease_started_at AND lease_expires_at<=lease_started_at+interval '15 seconds'),
 UNIQUE(receipt_id,command_id,link_id)
);
ALTER TABLE gpt02_private.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.operator_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.operator_links FORCE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.core_identity_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.core_identity_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.post_consumption_fences ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.post_consumption_fences FORCE ROW LEVEL SECURITY;

CREATE POLICY approvals_owner ON gpt02_private.approvals FOR ALL TO gpt02_store_owner USING(true) WITH CHECK(true);
CREATE POLICY links_owner ON gpt02_private.operator_links FOR ALL TO gpt02_store_owner USING(true) WITH CHECK(true);
CREATE POLICY receipts_owner ON gpt02_private.receipts FOR ALL TO gpt02_store_owner USING(true) WITH CHECK(true);
CREATE POLICY identity_owner ON gpt02_private.core_identity_receipts FOR ALL TO gpt02_store_owner USING(true) WITH CHECK(true);
CREATE POLICY fences_owner ON gpt02_private.post_consumption_fences FOR ALL TO gpt02_store_owner USING(true) WITH CHECK(true);
CREATE TRIGGER approvals_append_only BEFORE UPDATE OR DELETE ON gpt02_private.approvals
 FOR EACH ROW EXECUTE FUNCTION gpt02_private.reject_mutation();
CREATE TRIGGER links_append_only BEFORE UPDATE OR DELETE ON gpt02_private.operator_links
 FOR EACH ROW EXECUTE FUNCTION gpt02_private.reject_mutation();
CREATE TRIGGER receipts_append_only BEFORE UPDATE OR DELETE ON gpt02_private.receipts
 FOR EACH ROW EXECUTE FUNCTION gpt02_private.reject_mutation();
CREATE TRIGGER identity_append_only BEFORE UPDATE OR DELETE ON gpt02_private.core_identity_receipts
 FOR EACH ROW EXECUTE FUNCTION gpt02_private.reject_mutation();
CREATE TRIGGER fences_append_only BEFORE UPDATE OR DELETE ON gpt02_private.post_consumption_fences
 FOR EACH ROW EXECUTE FUNCTION gpt02_private.reject_mutation();
RESET ROLE;

-- Mirror Supabase-managed migration role: CREATEROLE and ADMIN membership,
-- but SET OPTION permanently false for the two nonlogin owners.
CREATE ROLE gpt02_fixture_migrator LOGIN CREATEROLE NOINHERIT NOBYPASSRLS;
GRANT gpt02_core_prep_owner TO gpt02_fixture_migrator WITH ADMIN TRUE, SET FALSE, INHERIT FALSE;
GRANT gpt02_store_owner TO gpt02_fixture_migrator WITH ADMIN TRUE, SET FALSE, INHERIT FALSE;
GRANT USAGE ON SCHEMA extensions TO gpt02_fixture_migrator WITH GRANT OPTION;