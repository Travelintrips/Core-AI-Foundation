-- CST-DEV SECURITY REPAIR: detach append-only evidence ownership from
-- general Core/Hub application DB login 'postgres'. No authorization enabled.
-- Must execute atomically. Fail with rollback unless both evidence tables empty.
SET LOCAL lock_timeout='5s';
DO $preflight$
BEGIN
 IF to_regclass('ai_platform.dev_gpt02_task_attempt_binding_claims') IS NULL
    OR to_regclass('ai_platform.dev_gpt02_binding_attestation_nonces') IS NULL
 THEN RAISE EXCEPTION 'GPT02_EVIDENCE_SCHEMA_MISSING'; END IF;
 IF EXISTS (SELECT 1 FROM ai_platform.dev_gpt02_task_attempt_binding_claims)
    OR EXISTS (SELECT 1 FROM ai_platform.dev_gpt02_binding_attestation_nonces)
 THEN RAISE EXCEPTION 'GPT02_EVIDENCE_NOT_EMPTY_REVIEW_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='dev_gpt02_evidence_owner')
 THEN RAISE EXCEPTION 'GPT02_EVIDENCE_OWNER_ROLE_ALREADY_EXISTS'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='dev_gpt02_claim_writer_nologin')
 THEN RAISE EXCEPTION 'GPT02_INSERT_ONLY_CAPABILITY_MISSING'; END IF;
 IF EXISTS(
   SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   JOIN pg_roles r ON r.oid=c.relowner
   WHERE n.nspname='ai_platform'
     AND c.relname IN ('dev_gpt02_task_attempt_binding_claims',
                       'dev_gpt02_binding_attestation_nonces')
     AND r.rolname<>'postgres')
 THEN RAISE EXCEPTION 'GPT02_UNEXPECTED_EVIDENCE_OWNER'; END IF;
END $preflight$;
CREATE ROLE dev_gpt02_evidence_owner NOLOGIN NOINHERIT NOSUPERUSER
 NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
-- PostgreSQL 17 creator membership may have SET=FALSE. Enable it only
-- during this transaction, then revoke the whole membership below.
GRANT dev_gpt02_evidence_owner TO postgres WITH SET TRUE;
-- Owner transfers also require CREATE privilege on the containing schema;
-- grant it temporarily and revoke before transaction commit.
GRANT CREATE ON SCHEMA ai_platform TO dev_gpt02_evidence_owner;
ALTER TABLE ai_platform.dev_gpt02_task_attempt_binding_claims
 OWNER TO dev_gpt02_evidence_owner;
ALTER TABLE ai_platform.dev_gpt02_binding_attestation_nonces
 OWNER TO dev_gpt02_evidence_owner;
ALTER FUNCTION ai_platform.dev_gpt02_task_binding_immutable()
 OWNER TO dev_gpt02_evidence_owner;
ALTER FUNCTION ai_platform.dev_gpt02_nonce_immutable()
 OWNER TO dev_gpt02_evidence_owner;
-- Postgres 17 creator ADMIN membership may remain even after REVOKE.
-- The Hub app logs in as postgres (CREATEROLE + pg_read_all_data), so this
-- migration proves only direct DML/SET-role fencing, NOT full trust isolation.
-- The app must eventually migrate to a separately restricted login.
REVOKE CREATE ON SCHEMA ai_platform FROM dev_gpt02_evidence_owner;
REVOKE dev_gpt02_claim_writer_nologin FROM postgres;
REVOKE dev_gpt02_evidence_owner FROM postgres;
DO $verify$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='dev_gpt02_evidence_owner'
    AND (rolcanlogin OR rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls))
 OR has_table_privilege('postgres','ai_platform.dev_gpt02_task_attempt_binding_claims','INSERT')
 OR has_table_privilege('postgres','ai_platform.dev_gpt02_binding_attestation_nonces','INSERT')
 OR has_table_privilege('postgres','ai_platform.dev_gpt02_task_attempt_binding_claims','INSERT,UPDATE,DELETE')
 OR has_table_privilege('postgres','ai_platform.dev_gpt02_binding_attestation_nonces','INSERT,UPDATE,DELETE')
 OR pg_has_role('postgres','dev_gpt02_claim_writer_nologin','SET')
 OR pg_has_role('postgres','dev_gpt02_evidence_owner','SET')
 OR has_schema_privilege('dev_gpt02_evidence_owner','ai_platform','CREATE')
 OR NOT has_table_privilege('dev_gpt02_claim_writer_nologin',
    'ai_platform.dev_gpt02_task_attempt_binding_claims','INSERT')
 OR NOT has_table_privilege('dev_gpt02_claim_writer_nologin',
    'ai_platform.dev_gpt02_binding_attestation_nonces','INSERT')
 OR has_table_privilege('dev_gpt02_claim_writer_nologin',
    'ai_platform.dev_gpt02_task_attempt_binding_claims','SELECT,UPDATE,DELETE')
 OR has_table_privilege('dev_gpt02_claim_writer_nologin',
    'ai_platform.dev_gpt02_binding_attestation_nonces','SELECT,UPDATE,DELETE')
 THEN RAISE EXCEPTION 'GPT02_WRITER_DML_OR_SET_ROLE_NOT_FENCED:%',
 jsonb_build_object(
 'postgres_claim_insert',has_table_privilege('postgres','ai_platform.dev_gpt02_task_attempt_binding_claims','INSERT'),
 'postgres_nonce_insert',has_table_privilege('postgres','ai_platform.dev_gpt02_binding_attestation_nonces','INSERT'),
 'postgres_claim_excess',has_table_privilege('postgres','ai_platform.dev_gpt02_task_attempt_binding_claims','INSERT,UPDATE,DELETE'),
 'postgres_nonce_excess',has_table_privilege('postgres','ai_platform.dev_gpt02_binding_attestation_nonces','INSERT,UPDATE,DELETE'),
 'member_writer',pg_has_role('postgres','dev_gpt02_claim_writer_nologin','MEMBER'),
 'member_owner',pg_has_role('postgres','dev_gpt02_evidence_owner','MEMBER'),
 'owner_create',has_schema_privilege('dev_gpt02_evidence_owner','ai_platform','CREATE'),
 'writer_claim_insert',has_table_privilege('dev_gpt02_claim_writer_nologin','ai_platform.dev_gpt02_task_attempt_binding_claims','INSERT'),
 'writer_nonce_insert',has_table_privilege('dev_gpt02_claim_writer_nologin','ai_platform.dev_gpt02_binding_attestation_nonces','INSERT'),
 'writer_excess',has_table_privilege('dev_gpt02_claim_writer_nologin','ai_platform.dev_gpt02_task_attempt_binding_claims','SELECT,UPDATE,DELETE'), 
 'postgres_can_set_writer',pg_has_role('postgres','dev_gpt02_claim_writer_nologin','SET'),
 'postgres_can_set_owner',pg_has_role('postgres','dev_gpt02_evidence_owner','SET'),
 'postgres_claim_update',has_table_privilege('postgres','ai_platform.dev_gpt02_task_attempt_binding_claims','UPDATE'),
 'postgres_nonce_update',has_table_privilege('postgres','ai_platform.dev_gpt02_binding_attestation_nonces','UPDATE'),
 'writer_member_rows',(SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE r.rolname='dev_gpt02_claim_writer_nologin'),
 'owner_member_rows',(SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE r.rolname='dev_gpt02_evidence_owner')
 ); END IF;
END $verify$;
