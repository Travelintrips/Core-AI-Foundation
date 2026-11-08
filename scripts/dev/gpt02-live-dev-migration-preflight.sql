-- GPT02 DEV migration preflight: read-only, fail closed.
-- Explicitly DOES NOT install proposed SQL, approve execution, or dispatch a worker.
-- Execute with psql -X -v ON_ERROR_STOP=1 -f this-file.sql.
-- Run against the intended authorized DEV database with a scoped readonly operator.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
DO $preflight$
DECLARE
  binding oid := to_regclass('ai_platform.dev_gpt02_task_attempt_binding_claims');
  nonce oid := to_regclass('ai_platform.dev_gpt02_binding_attestation_nonces');
  unsafe_schema_access boolean;
BEGIN
  IF binding IS NULL AND nonce IS NULL THEN
    RAISE EXCEPTION 'GPT02_DEV_SCHEMA_NOT_INSTALLED_REQUIRES_SEPARATE_APPROVED_MIGRATION'
      USING ERRCODE='55000';
  END IF;
  IF binding IS NULL OR nonce IS NULL THEN
    RAISE EXCEPTION 'GPT02_DEV_PARTIAL_SCHEMA_REQUIRES_MANUAL_RECONCILIATION'
      USING ERRCODE='55000';
  END IF;
  IF (SELECT relkind NOT IN ('r','p') FROM pg_catalog.pg_class WHERE oid=binding)
     OR (SELECT relkind NOT IN ('r','p') FROM pg_catalog.pg_class WHERE oid=nonce) THEN
    RAISE EXCEPTION 'GPT02_DEV_SCHEMA_OBJECT_KIND_DRIFT' USING ERRCODE='55000';
  END IF;
  -- pg_catalog metadata only; this is not evidence of approved worker release.
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace ns
    CROSS JOIN LATERAL aclexplode(COALESCE(ns.nspacl,acldefault('n',ns.nspowner))) a
    WHERE ns.nspname='ai_platform' AND a.grantee=0
      AND a.privilege_type='CREATE'
  ) INTO unsafe_schema_access;
  IF unsafe_schema_access THEN
    RAISE EXCEPTION 'GPT02_DEV_PUBLIC_SCHEMA_CREATE_DRIFT' USING ERRCODE='55000';
  END IF;
END
$preflight$;
-- Full catalogs: uniqueness, immutable triggers, operator checks, FK,
-- deny-by-default grants and nonce freshness all required together.
\ir gpt02-task-binding-schema-drift-guard.sql
\ir gpt02-binding-nonce-schema-drift-guard.sql
ROLLBACK;
-- Success only means catalog state matches the inert proposal; never readiness.
\echo GPT02_DEV_INERT_SCHEMA_PREFLIGHT_PASS_NOT_RELEASE_AUTHORIZATION
