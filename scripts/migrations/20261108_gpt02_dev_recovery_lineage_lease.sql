-- DEV-ONLY, additive recovery lineage and lease DATA MODEL. No issuer, grant, or dispatch.
-- Do NOT apply to production. Requires explicit DEV session migration guard.
BEGIN;
DO $guard$
BEGIN
  IF current_setting('ai_core.dev_migration_authorized', true) IS DISTINCT FROM 'true' THEN
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

-- The issuing transaction must insert this durable lineage row atomically
-- alongside a newly issued command, under a shared parent lock.
CREATE TABLE IF NOT EXISTS ai_platform.gpt02_dev_recovery_command_links (
  parent_command_id uuid PRIMARY KEY REFERENCES ai_platform.ai_coding_bridge_commands(id),
  child_command_id uuid NOT NULL UNIQUE REFERENCES ai_platform.ai_coding_bridge_commands(id),
  reservation_id uuid NOT NULL UNIQUE REFERENCES ai_platform.gpt02_dev_recovery_reservations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gpt02_recovery_links_distinct CHECK (parent_command_id <> child_command_id)
);

-- Enforce that each link's parent and candidate agree with the existing
-- reserved identity. The issuer will still need its own SERIALIZABLE/CAS gate.
CREATE OR REPLACE FUNCTION ai_platform.gpt02_dev_recovery_lineage_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $body$
DECLARE expected_parent uuid; expected_candidate uuid;
BEGIN
  SELECT parent_command_id, candidate_command_id
    INTO expected_parent, expected_candidate
    FROM ai_platform.gpt02_dev_recovery_reservations
    WHERE id=NEW.reservation_id FOR UPDATE;
  IF NOT FOUND OR expected_parent IS DISTINCT FROM NEW.parent_command_id
     OR expected_candidate IS DISTINCT FROM NEW.child_command_id THEN
    RAISE EXCEPTION 'GPT02_RECOVERY_LINK_IDENTITY_MISMATCH';
  END IF;
  RETURN NEW;
END $body$;
DROP TRIGGER IF EXISTS gpt02_recovery_lineage_guard_trg
 ON ai_platform.gpt02_dev_recovery_command_links;
CREATE TRIGGER gpt02_recovery_lineage_guard_trg
 BEFORE INSERT OR UPDATE ON ai_platform.gpt02_dev_recovery_command_links
 FOR EACH ROW EXECUTE FUNCTION ai_platform.gpt02_dev_recovery_lineage_guard();

-- Fencing is monotonic on each reservation and never resets on release.
-- This table DOES NOT confer execution authority; all dispatch paths remain closed.
CREATE TABLE IF NOT EXISTS ai_platform.gpt02_dev_recovery_leases (
  reservation_id uuid PRIMARY KEY REFERENCES ai_platform.gpt02_dev_recovery_reservations(id),
  fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  lease_owner text,
  lease_expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gpt02_recovery_lease_pair CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL)),
  CONSTRAINT gpt02_recovery_lease_owner_valid CHECK (lease_owner IS NULL OR length(trim(lease_owner)) BETWEEN 1 AND 128)
);

DO $drift$
DECLARE cols text[]; constraints text[];
BEGIN
  SELECT array_agg(column_name||':'||data_type ORDER BY ordinal_position)
    INTO cols FROM information_schema.columns
    WHERE table_schema='ai_platform' AND table_name='gpt02_dev_recovery_command_links';
  IF cols IS DISTINCT FROM ARRAY[
    'parent_command_id:uuid','child_command_id:uuid','reservation_id:uuid','created_at:timestamp with time zone'
  ] THEN
    RAISE EXCEPTION 'GPT02_RECOVERY_LINEAGE_SCHEMA_DRIFT';
  END IF;
  SELECT array_agg(conname::text ORDER BY conname) INTO constraints
    FROM pg_constraint WHERE conrelid='ai_platform.gpt02_dev_recovery_command_links'::regclass;
  IF NOT ARRAY['gpt02_dev_recovery_command_links_pkey','gpt02_dev_recovery_command_links_child_command_id_key',
    'gpt02_dev_recovery_command_links_reservation_id_key','gpt02_recovery_links_distinct'] <@ constraints THEN
    RAISE EXCEPTION 'GPT02_RECOVERY_LINEAGE_CONSTRAINT_DRIFT';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid='ai_platform.gpt02_dev_recovery_command_links'::regclass
    AND tgname='gpt02_recovery_lineage_guard_trg' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'GPT02_RECOVERY_LINEAGE_TRIGGER_MISSING';
  END IF;
  SELECT array_agg(column_name||':'||data_type ORDER BY ordinal_position)
    INTO cols FROM information_schema.columns
    WHERE table_schema='ai_platform' AND table_name='gpt02_dev_recovery_leases';
  IF cols IS DISTINCT FROM ARRAY[
    'reservation_id:uuid','fencing_token:bigint','lease_owner:text',
    'lease_expires_at:timestamp with time zone','updated_at:timestamp with time zone'
  ] THEN
    RAISE EXCEPTION 'GPT02_RECOVERY_LEASE_SCHEMA_DRIFT';
  END IF;
  SELECT array_agg(conname::text ORDER BY conname) INTO constraints
    FROM pg_constraint WHERE conrelid='ai_platform.gpt02_dev_recovery_leases'::regclass;
  IF NOT ARRAY['gpt02_dev_recovery_leases_pkey','gpt02_recovery_lease_pair',
    'gpt02_recovery_lease_owner_valid','gpt02_dev_recovery_leases_fencing_token_check'] <@ constraints THEN
    RAISE EXCEPTION 'GPT02_RECOVERY_LEASE_CONSTRAINT_DRIFT';
  END IF;
END $drift$;

ALTER TABLE ai_platform.gpt02_dev_recovery_command_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.gpt02_dev_recovery_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ai_platform.gpt02_dev_recovery_command_links FROM PUBLIC;
REVOKE ALL ON ai_platform.gpt02_dev_recovery_leases FROM PUBLIC;
DO $roles$
DECLARE role_name text;
BEGIN
 FOR role_name IN SELECT rolname FROM pg_roles
   WHERE rolname IN ('anon','authenticated','aicore_dev_runtime')
 LOOP
   EXECUTE format('REVOKE ALL ON ai_platform.gpt02_dev_recovery_command_links FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON ai_platform.gpt02_dev_recovery_leases FROM %I',role_name);
 END LOOP;
END $roles$;
-- No policies or runtime role grants. No live lease, command or links inserted here.
COMMIT;
