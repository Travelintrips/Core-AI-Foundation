-- Disposable PG16 fixture for the exact live approval function; NEVER live.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE gpt02_store_owner NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE gpt02_core_prep_owner NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE dev_gpt02_attestor_evidence NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE dev_gpt02_issuer_evidence NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE SCHEMA gpt02_stage AUTHORIZATION gpt02_core_prep_owner;
CREATE SCHEMA gpt02_private AUTHORIZATION gpt02_store_owner;
REVOKE ALL ON SCHEMA gpt02_stage,gpt02_private FROM PUBLIC;

SET ROLE gpt02_core_prep_owner;
CREATE TABLE gpt02_stage.core_preparations(
 company_id text NOT NULL,
 hub_task_id integer NOT NULL,
 command_candidate_id uuid NOT NULL UNIQUE,
 attempt_id uuid NOT NULL UNIQUE,
 hub_execution_id uuid NOT NULL UNIQUE,
 core_task_id uuid NOT NULL UNIQUE,
 member_id integer NOT NULL,
 operator_subject text NOT NULL,
 expires_at timestamptz NOT NULL,
 PRIMARY KEY(company_id,hub_task_id)
);
ALTER TABLE gpt02_stage.core_preparations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_stage.core_preparations FORCE ROW LEVEL SECURITY;
CREATE POLICY prep_owner_only ON gpt02_stage.core_preparations
 FOR ALL TO gpt02_core_prep_owner USING(true) WITH CHECK(true);
CREATE POLICY gpt02_store_owner_preparation_read ON gpt02_stage.core_preparations
 FOR SELECT TO gpt02_store_owner USING(company_id='default' AND hub_task_id>139);
GRANT SELECT ON gpt02_stage.core_preparations TO gpt02_store_owner;
GRANT USAGE ON SCHEMA gpt02_stage TO gpt02_store_owner;
RESET ROLE;

SET ROLE gpt02_store_owner;
CREATE TABLE gpt02_private.approvals(
 command_id uuid PRIMARY KEY,attempt_id uuid NOT NULL UNIQUE,nonce text NOT NULL UNIQUE,
 task_id integer NOT NULL,company_id text NOT NULL,approver_id text NOT NULL,
 claims jsonb NOT NULL,signature text NOT NULL,digest text NOT NULL,
 expires_at timestamptz NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 operator_namespace text NOT NULL
);
CREATE TABLE gpt02_private.operator_links(
 link_id uuid PRIMARY KEY,command_id uuid NOT NULL UNIQUE,
 hub_execution_id uuid NOT NULL UNIQUE,core_task_id uuid NOT NULL,
 hub_task_id integer NOT NULL,attempt_id uuid NOT NULL UNIQUE,
 attempt_number integer NOT NULL,company_id text NOT NULL,assignee_id integer NOT NULL,
 accountable_owner_id text NOT NULL,hub_operator_id text NOT NULL,
 core_operator_user_id integer NOT NULL,
 approval_digest text NOT NULL,link_digest text NOT NULL,
 hub_signature text NOT NULL,core_signature text NOT NULL,
 claims jsonb NOT NULL,expires_at timestamptz NOT NULL
);
ALTER TABLE gpt02_private.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.operator_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.operator_links FORCE ROW LEVEL SECURITY;
CREATE POLICY approval_owner ON gpt02_private.approvals
 FOR ALL TO gpt02_store_owner USING(true) WITH CHECK(true);
CREATE POLICY link_owner ON gpt02_private.operator_links
 FOR ALL TO gpt02_store_owner USING(true) WITH CHECK(true);
GRANT USAGE ON SCHEMA gpt02_private TO dev_gpt02_attestor_evidence;
RESET ROLE;

CREATE ROLE gpt02_fixture_migrator LOGIN CREATEROLE NOINHERIT NOBYPASSRLS;
GRANT gpt02_store_owner TO gpt02_fixture_migrator WITH ADMIN TRUE,SET FALSE,INHERIT FALSE;
GRANT USAGE ON SCHEMA gpt02_private TO gpt02_fixture_migrator;