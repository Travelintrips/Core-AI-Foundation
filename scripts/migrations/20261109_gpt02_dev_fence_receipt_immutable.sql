-- DEV-only additive immutability barrier for already-installed signing receipts.
-- The original receipt migration remains intact. No issuer, dispatch or replay.
BEGIN;
DO $guard$
BEGIN
 IF current_setting('ai_core.dev_migration_authorized',true) IS DISTINCT FROM 'true'
 THEN RAISE EXCEPTION 'GPT02_DEV_MIGRATION_AUTHORIZATION_REQUIRED'; END IF;
 IF to_regclass('ai_platform.gpt02_dev_native_fence_signing_receipts') IS NULL OR
    NOT EXISTS (
      SELECT 1 FROM pg_class c
      WHERE c.oid='ai_platform.gpt02_dev_native_fence_signing_receipts'::regclass
        AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
        AND c.relrowsecurity IS TRUE
    )
 THEN RAISE EXCEPTION 'GPT02_FENCE_RECEIPT_OWNER_OR_RLS_MISMATCH'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION ai_platform.gpt02_dev_fence_receipt_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,ai_platform
AS $body$
BEGIN
 RAISE EXCEPTION 'GPT02_FENCE_RECEIPT_IMMUTABLE' USING ERRCODE='55000';
END $body$;

REVOKE ALL ON FUNCTION ai_platform.gpt02_dev_fence_receipt_immutable() FROM PUBLIC;
DROP TRIGGER IF EXISTS gpt02_dev_fence_receipt_immutable_rows_trg
 ON ai_platform.gpt02_dev_native_fence_signing_receipts;
CREATE TRIGGER gpt02_dev_fence_receipt_immutable_rows_trg
 BEFORE UPDATE OR DELETE ON ai_platform.gpt02_dev_native_fence_signing_receipts
 FOR EACH ROW EXECUTE FUNCTION ai_platform.gpt02_dev_fence_receipt_immutable();

DROP TRIGGER IF EXISTS gpt02_dev_fence_receipt_immutable_truncate_trg
 ON ai_platform.gpt02_dev_native_fence_signing_receipts;
CREATE TRIGGER gpt02_dev_fence_receipt_immutable_truncate_trg
 BEFORE TRUNCATE ON ai_platform.gpt02_dev_native_fence_signing_receipts
 FOR EACH STATEMENT EXECUTE FUNCTION ai_platform.gpt02_dev_fence_receipt_immutable();

DO $verify$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM pg_trigger
   WHERE tgrelid='ai_platform.gpt02_dev_native_fence_signing_receipts'::regclass
     AND tgname='gpt02_dev_fence_receipt_immutable_rows_trg'
     AND NOT tgisinternal AND tgenabled='O'
 ) OR NOT EXISTS (
   SELECT 1 FROM pg_trigger
   WHERE tgrelid='ai_platform.gpt02_dev_native_fence_signing_receipts'::regclass
     AND tgname='gpt02_dev_fence_receipt_immutable_truncate_trg'
     AND NOT tgisinternal AND tgenabled='O'
 )
 THEN RAISE EXCEPTION 'GPT02_FENCE_RECEIPT_IMMUTABILITY_TRIGGER_MISSING'; END IF;
END $verify$;

-- Ordinary runtime/browser roles retain no mutation privileges.
REVOKE UPDATE, DELETE, TRUNCATE ON ai_platform.gpt02_dev_native_fence_signing_receipts FROM PUBLIC;
DO $roles$
DECLARE role_name text;
BEGIN
 FOR role_name IN SELECT rolname FROM pg_roles
 WHERE rolname IN ('anon','authenticated','aicore_dev_runtime')
 LOOP
 EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON ai_platform.gpt02_dev_native_fence_signing_receipts FROM %I',role_name);
 END LOOP;
END $roles$;
COMMIT;
