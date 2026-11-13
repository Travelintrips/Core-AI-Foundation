-- RFC ONLY / DO NOT APPLY TO CST-DEV OR PROD.
-- The existing API still uses the ordinary @workspace/db runtime connection.
-- No dedicated writer credential, deployment, or lease/grant issuer exists.
-- This SQL models an isolated capability for a future independently
-- authenticated DEV-only review writer service.
-- Never attach the writer role to aicore_dev_runtime or to public roles.
BEGIN;
-- Deliberate unconditional stop. The role-only RFC permits unsigned INSERT
-- and is NOT a security-reviewed writer implementation. Do not execute it.
DO $rfc_disabled$
BEGIN
 RAISE EXCEPTION 'GPT02_REVIEW_WRITER_RFC_UNSAFE_NOT_DEPLOYABLE'
 USING ERRCODE='0A000';
END
$rfc_disabled$;
DO $guard$
BEGIN
 IF to_regclass('ai_platform.dev_gpt02_operator_review_intents') IS NULL
    OR to_regclass('ai_platform.ai_coding_bridge_commands') IS NULL
    OR to_regclass('ai_platform.ai_coding_bridge_responses') IS NULL
    OR to_regclass('ai_platform.internal_users') IS NULL THEN
  RAISE EXCEPTION 'GPT02_WRITER_RFC_REQUIRED_TABLE_MISSING';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='aicore_dev_runtime'
            AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'GPT02_WRITER_RFC_RUNTIME_UNSAFE';
 END IF;
END
$guard$;
DO $role$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='gpt02_dev_review_writer') THEN
  CREATE ROLE gpt02_dev_review_writer NOLOGIN NOINHERIT NOBYPASSRLS;
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='gpt02_dev_review_writer'
            AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolinherit)) THEN
  RAISE EXCEPTION 'GPT02_WRITER_RFC_ROLE_DRIFT';
 END IF;
END
$role$;
GRANT USAGE ON SCHEMA ai_platform TO gpt02_dev_review_writer;
GRANT SELECT,INSERT ON TABLE ai_platform.dev_gpt02_operator_review_intents
  TO gpt02_dev_review_writer;
GRANT SELECT ON TABLE ai_platform.ai_coding_bridge_commands,
  ai_platform.ai_coding_bridge_responses,ai_platform.internal_users
  TO gpt02_dev_review_writer;
-- No UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER on audit table.
-- This draft role deliberately CANNOT acquire SELECT FOR UPDATE row locks
-- on command records and thus cannot be plugged into existing persistence
-- without a separate, reviewed command-locking design.
DO $policy$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_policy
  WHERE polrelid='ai_platform.dev_gpt02_operator_review_intents'::regclass
   AND polname='dev_gpt02_review_writer_insert') THEN
  RAISE EXCEPTION 'GPT02_WRITER_RFC_POLICY_ALREADY_EXISTS_REVIEW_REQUIRED';
 END IF;
 EXECUTE 'CREATE POLICY dev_gpt02_review_writer_insert
    ON ai_platform.dev_gpt02_operator_review_intents
    AS PERMISSIVE FOR INSERT TO gpt02_dev_review_writer WITH CHECK (true)';
END
$policy$;
-- This RLS insert policy enforces role separation, NOT the Ed25519 signature.
-- Signature + native ACK must be verified before invoking any writer.
-- A future writer must preserve existing locking/race semantics and
-- must not run with this capability until the architecture is reviewed.
COMMIT;
