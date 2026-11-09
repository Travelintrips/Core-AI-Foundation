-- CST-DEV: non-login writer CAPABILITY ONLY. Not an operational credential.
-- Requires append-only claim and nonce tables already installed and empty.
-- No runtime/app memberships, passwords, logins, APIs, dispatch, or issuer.
-- PostgreSQL may auto-register the provisioning role 'postgres' as role admin;
-- that administrative membership is tolerated, all other members denied.
SET LOCAL lock_timeout='5s';
DO $guard$
BEGIN
  IF to_regclass('ai_platform.dev_gpt02_task_attempt_binding_claims') IS NULL
   OR to_regclass('ai_platform.dev_gpt02_binding_attestation_nonces') IS NULL
  THEN RAISE EXCEPTION 'GPT02_EVIDENCE_SCHEMA_MISSING'; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='dev_gpt02_claim_writer_nologin')
  THEN RAISE EXCEPTION 'GPT02_WRITER_ROLE_ALREADY_EXISTS_REVIEW_REQUIRED'; END IF;
  IF EXISTS(SELECT 1 FROM ai_platform.dev_gpt02_task_attempt_binding_claims)
   OR EXISTS(SELECT 1 FROM ai_platform.dev_gpt02_binding_attestation_nonces)
  THEN RAISE EXCEPTION 'GPT02_NONEMPTY_EVIDENCE_REVIEW_REQUIRED'; END IF;
END $guard$;
CREATE ROLE dev_gpt02_claim_writer_nologin NOLOGIN NOINHERIT NOSUPERUSER
 NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA ai_platform TO dev_gpt02_claim_writer_nologin;
GRANT INSERT ON ai_platform.dev_gpt02_task_attempt_binding_claims,
 ai_platform.dev_gpt02_binding_attestation_nonces TO dev_gpt02_claim_writer_nologin;
DO $verify$
BEGIN
  IF (SELECT rolcanlogin OR rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls
      FROM pg_roles WHERE rolname='dev_gpt02_claim_writer_nologin')
    OR EXISTS(SELECT 1 FROM pg_auth_members m
              JOIN pg_roles r ON r.oid=m.roleid
              JOIN pg_roles member_role ON member_role.oid=m.member
              WHERE r.rolname='dev_gpt02_claim_writer_nologin'
                AND member_role.rolname <> 'postgres')
    OR NOT has_table_privilege('dev_gpt02_claim_writer_nologin',
          'ai_platform.dev_gpt02_task_attempt_binding_claims','INSERT')
    OR NOT has_table_privilege('dev_gpt02_claim_writer_nologin',
          'ai_platform.dev_gpt02_binding_attestation_nonces','INSERT')
    OR has_table_privilege('dev_gpt02_claim_writer_nologin',
          'ai_platform.dev_gpt02_task_attempt_binding_claims','SELECT,UPDATE,DELETE')
    OR has_table_privilege('dev_gpt02_claim_writer_nologin',
          'ai_platform.dev_gpt02_binding_attestation_nonces','SELECT,UPDATE,DELETE')
    OR has_schema_privilege('dev_gpt02_claim_writer_nologin','ai_platform','CREATE')
  THEN RAISE EXCEPTION 'GPT02_NONLOGIN_WRITER_ROLE_PRIVILEGE_DRIFT'; END IF;
END $verify$;
