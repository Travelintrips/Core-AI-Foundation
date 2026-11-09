-- DEV-only additive, fail-closed receipt ledger for one-shot native fencing signatures.
-- No issuer or dispatch. Do NOT apply on PROD. No grants to ordinary runtime.
BEGIN;
DO $guard$
BEGIN
  IF current_setting('ai_core.dev_migration_authorized',true) IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'GPT02_DEV_MIGRATION_AUTHORIZATION_REQUIRED'; END IF;
  IF to_regclass('ai_platform.gpt02_dev_recovery_reservations') IS NULL OR
     to_regclass('ai_platform.gpt02_dev_recovery_command_links') IS NULL OR
     to_regclass('ai_platform.gpt02_dev_recovery_leases') IS NULL OR
     NOT EXISTS(
       SELECT 1 FROM pg_class c
       WHERE c.oid='ai_platform.gpt02_dev_recovery_reservations'::regclass
         AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
         AND c.relrowsecurity IS TRUE
     )
  THEN RAISE EXCEPTION 'GPT02_FENCE_RECEIPT_OWNER_OR_SCHEMA_MISMATCH'; END IF;
END $guard$;

CREATE TABLE IF NOT EXISTS ai_platform.gpt02_dev_native_fence_signing_receipts (
  reservation_id uuid NOT NULL REFERENCES ai_platform.gpt02_dev_recovery_reservations(id),
  child_command_id uuid NOT NULL REFERENCES ai_platform.ai_coding_bridge_commands(id),
  fencing_token bigint NOT NULL CHECK (fencing_token > 0),
  sequence bigint NOT NULL CHECK (sequence = 0),
  worker_id text NOT NULL CHECK (worker_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  signature_sha256 text NOT NULL CHECK (signature_sha256 ~ '^[0-9a-f]{64}$'),
  issued_at_utc_ms bigint NOT NULL CHECK (issued_at_utc_ms > 0),
  expires_at_utc_ms bigint NOT NULL CHECK (
    expires_at_utc_ms > issued_at_utc_ms AND
    expires_at_utc_ms - issued_at_utc_ms BETWEEN 1000 AND 30000
  ),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT gpt02_dev_native_fence_receipts_pkey PRIMARY KEY(reservation_id,sequence),
  CONSTRAINT gpt02_dev_native_fence_receipts_unique_token UNIQUE(reservation_id,fencing_token,sequence),
  CONSTRAINT gpt02_dev_native_fence_receipts_child_unique UNIQUE(child_command_id,sequence)
);
DO $drift$
DECLARE cols text[];
BEGIN
 SELECT array_agg(column_name||':'||data_type ORDER BY ordinal_position)
 INTO cols FROM information_schema.columns
 WHERE table_schema='ai_platform' AND table_name='gpt02_dev_native_fence_signing_receipts';
 IF cols IS DISTINCT FROM ARRAY[
 'reservation_id:uuid','child_command_id:uuid','fencing_token:bigint',
 'sequence:bigint','worker_id:text','payload_sha256:text',
 'signature_sha256:text','issued_at_utc_ms:bigint','expires_at_utc_ms:bigint',
 'created_at:timestamp with time zone'
 ] THEN RAISE EXCEPTION 'GPT02_FENCE_RECEIPT_SCHEMA_DRIFT'; END IF;
 IF NOT EXISTS(
   SELECT 1 FROM pg_constraint
   WHERE conrelid='ai_platform.gpt02_dev_native_fence_signing_receipts'::regclass
     AND conname='gpt02_dev_native_fence_receipts_pkey' AND contype='p'
 ) OR NOT EXISTS(
   SELECT 1 FROM pg_constraint
   WHERE conrelid='ai_platform.gpt02_dev_native_fence_signing_receipts'::regclass
     AND conname='gpt02_dev_native_fence_receipts_child_unique' AND contype='u'
 ) THEN RAISE EXCEPTION 'GPT02_FENCE_RECEIPT_CONSTRAINT_DRIFT'; END IF;
END $drift$;
ALTER TABLE ai_platform.gpt02_dev_native_fence_signing_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ai_platform.gpt02_dev_native_fence_signing_receipts FROM PUBLIC;
DO $roles$
DECLARE role_name text;
BEGIN
 FOR role_name IN SELECT rolname FROM pg_roles
   WHERE rolname IN ('anon','authenticated','aicore_dev_runtime')
 LOOP
   EXECUTE format('REVOKE ALL ON ai_platform.gpt02_dev_native_fence_signing_receipts FROM %I',role_name);
 END LOOP;
END $roles$;
COMMENT ON TABLE ai_platform.gpt02_dev_native_fence_signing_receipts IS
 'DEV-only initial proof issuance once; NO worker dispatch or ACK authority.';
COMMIT;
