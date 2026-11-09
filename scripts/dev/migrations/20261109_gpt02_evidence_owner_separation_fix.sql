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
ALTER TABLE ai_platform.dev_gpt02_task_attempt_binding_claims
 OWNER TO dev_gpt02_evidence_owner;
ALTER TABLE ai_platform.dev_gpt02_binding_attestation_nonces
 OWNER TO dev_gpt02_evidence_owner;
ALTER FUNCTION ai_platform.dev_gpt02_task_binding_immutable()
 OWNER TO dev_gpt02_evidence_owner;
ALTER FUNCTION ai_platform.dev_gpt02_nonce_immutable()
 OWNER TO dev_gpt02_evidence_owner;
-- Postgres 17 automatically grants the creator admin membership. The Hub
-- application logs in as postgres, so that MUST be revoked on both roles.
REVOKE dev_gpt02_claim_writer_nologin FROM postgres;
REVOKE dev_gpt02_evidence_owner FROM postgres;
DO $verify$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='dev_gpt02_evidence_owner'
    AND (rolcanlogin OR rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls))
 OR has_table_privilege('postgres','ai_platform.dev_gpt02_task_attempt_binding_claims','INSERT')
 OR has_table_privilege('postgres','ai_platform.dev_gpt02_binding_attestation_nonces','INSERT')
 OR has_table_privilege('postgres','ai_platform.dev_gpt02_task_attempt_binding_claims','SELECT,UPDATE,DELETE')
 OR has_table_privilege('postgres','ai_platform.dev_gpt02_binding_attestation_nonces','SELECT,UPDATE,DELETE')
 OR pg_has_role('postgres','dev_gpt02_claim_writer_nologin','MEMBER')
 OR pg_has_role('postgres','dev_gpt02_evidence_owner','MEMBER')
 OR NOT has_table_privilege('dev_gpt02_claim_writer_nologin',
    'ai_platform.dev_gpt02_task_attempt_binding_claims','INSERT')
 OR NOT has_table_privilege('dev_gpt02_claim_writer_nologin',
    'ai_platform.dev_gpt02_binding_attestation_nonces','INSERT')
 OR has_table_privilege('dev_gpt02_claim_writer_nologin',
    'ai_platform.dev_gpt02_task_attempt_binding_claims','SELECT,UPDATE,DELETE')
 OR has_table_privilege('dev_gpt02_claim_writer_nologin',
    'ai_platform.dev_gpt02_binding_attestation_nonces','SELECT,UPDATE,DELETE')
 THEN RAISE EXCEPTION 'GPT02_APP_LOGIN_STILL_HAS_EVIDENCE_ACCESS'; END IF;
END $verify$;
