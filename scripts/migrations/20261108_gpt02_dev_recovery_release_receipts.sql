-- DEV-only append-only release receipt. Does NOT create or grant any execution lease.
-- Additive, no PROD changes. Apply only after isolated PostgreSQL tests and review.
BEGIN;
DO $guard$
BEGIN
  IF current_setting('ai_core.dev_migration_authorized',true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'GPT02_DEV_MIGRATION_AUTHORIZATION_REQUIRED';
  END IF;
  -- Require actual reservation-table ownership, not merely schema CREATE
  -- or an arbitrary session setting. This does not relax RLS or GRANTs.
  IF to_regclass('ai_platform.gpt02_dev_recovery_reservations') IS NULL OR
     NOT EXISTS (
       SELECT 1 FROM pg_class c WHERE
         c.oid='ai_platform.gpt02_dev_recovery_reservations'::regclass
         AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
         AND c.relrowsecurity IS TRUE AND c.relforcerowsecurity IS FALSE
     ) THEN
     RAISE EXCEPTION 'GPT02_RECOVERY_LEDGER_MIGRATION_OWNER_OR_RLS_MISMATCH';
  END IF;
END $guard$;

CREATE TABLE IF NOT EXISTS ai_platform.gpt02_dev_recovery_lease_releases (
  reservation_id uuid NOT NULL REFERENCES ai_platform.gpt02_dev_recovery_reservations(id),
  fencing_token bigint NOT NULL CHECK (fencing_token > 0),
  lease_owner text NOT NULL CHECK (length(trim(lease_owner)) BETWEEN 1 AND 128),
  released_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT gpt02_dev_recovery_lease_releases_pkey PRIMARY KEY (reservation_id,fencing_token)
);

DO $drift$
DECLARE
  columns_actual text[];
  constraints_actual text[];
BEGIN
  SELECT array_agg(column_name||':'||data_type ORDER BY ordinal_position)
  INTO columns_actual FROM information_schema.columns
  WHERE table_schema='ai_platform'
    AND table_name='gpt02_dev_recovery_lease_releases';
  IF columns_actual IS DISTINCT FROM ARRAY[
    'reservation_id:uuid','fencing_token:bigint','lease_owner:text',
    'released_at:timestamp with time zone'
  ] THEN RAISE EXCEPTION 'GPT02_LEASE_RELEASE_RECEIPT_SCHEMA_DRIFT'; END IF;
  SELECT array_agg(conname::text ORDER BY conname) INTO constraints_actual
  FROM pg_constraint WHERE conrelid='ai_platform.gpt02_dev_recovery_lease_releases'::regclass;
  IF NOT ARRAY['gpt02_dev_recovery_lease_releases_pkey',
    'gpt02_dev_recovery_lease_releases_fencing_token_check',
    'gpt02_dev_recovery_lease_releases_lease_owner_check'] <@ constraints_actual THEN
    RAISE EXCEPTION 'GPT02_LEASE_RELEASE_RECEIPT_CONSTRAINT_DRIFT';
  END IF;
END $drift$;

-- Append-only, even for privileged application roles. Only an authorized
-- migration administrator may alter the trigger; do not grant UPDATE/DELETE.
CREATE OR REPLACE FUNCTION ai_platform.gpt02_dev_recovery_release_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $immutable$
BEGIN
  RAISE EXCEPTION 'GPT02_RELEASE_RECEIPT_IMMUTABLE';
END $immutable$;
DROP TRIGGER IF EXISTS gpt02_dev_recovery_release_immutable_trg
  ON ai_platform.gpt02_dev_recovery_lease_releases;
CREATE TRIGGER gpt02_dev_recovery_release_immutable_trg
  BEFORE UPDATE OR DELETE ON ai_platform.gpt02_dev_recovery_lease_releases
  FOR EACH ROW EXECUTE FUNCTION ai_platform.gpt02_dev_recovery_release_immutable();

ALTER TABLE ai_platform.gpt02_dev_recovery_lease_releases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ai_platform.gpt02_dev_recovery_lease_releases FROM PUBLIC;
DO $roles$
DECLARE role_name text;
BEGIN
  FOR role_name IN SELECT rolname FROM pg_roles
    WHERE rolname IN ('anon','authenticated','aicore_dev_runtime')
  LOOP
    EXECUTE format('REVOKE ALL ON ai_platform.gpt02_dev_recovery_lease_releases FROM %I',role_name);
  END LOOP;
END $roles$;
-- No policies or grants, no active lease, no command and no dispatch.
COMMIT;
