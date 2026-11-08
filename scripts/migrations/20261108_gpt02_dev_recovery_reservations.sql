-- DEV-only GPT02 recovery reservation ledger. Additive, no command dispatch.
-- Apply only to AI Core DEV after isolated Postgres tests and review.
-- This migration does NOT insert reservations, commands, grants, leases or jobs.
BEGIN;
-- Caller must explicitly set this session-local guard in DEV.
-- Without the flag the migration fails closed before touching schema.
DO $environment$
BEGIN
  IF current_setting('ai_core.dev_migration_authorized',true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'GPT02_DEV_MIGRATION_AUTHORIZATION_REQUIRED';
  END IF;
END $environment$;
CREATE TABLE IF NOT EXISTS ai_platform.gpt02_dev_recovery_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_command_id UUID NOT NULL REFERENCES ai_platform.ai_coding_bridge_commands(id),
  candidate_command_id UUID NOT NULL,
  human_review_id INTEGER NOT NULL REFERENCES ai_platform.ai_human_tasks(id),
  job_id INTEGER NOT NULL CHECK (job_id > 0),
  idempotency_key UUID NOT NULL,
  artifact_sha256 TEXT NOT NULL CHECK (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  state TEXT NOT NULL DEFAULT 'reserved' CHECK (state = 'reserved'),
  execution_authorized BOOLEAN NOT NULL DEFAULT FALSE CHECK (execution_authorized IS FALSE),
  lease_token_hash TEXT NULL CHECK (lease_token_hash IS NULL),
  lease_owner_worker_id TEXT NULL CHECK (lease_owner_worker_id IS NULL),
  lease_expires_at TIMESTAMPTZ NULL CHECK (lease_expires_at IS NULL),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gpt02_recovery_candidate_distinct_ck CHECK (candidate_command_id <> parent_command_id),
  CONSTRAINT gpt02_recovery_parent_unique UNIQUE (parent_command_id),
  CONSTRAINT gpt02_recovery_candidate_unique UNIQUE (candidate_command_id),
  CONSTRAINT gpt02_recovery_idempotency_unique UNIQUE (idempotency_key)
);
-- Protect against CREATE TABLE IF NOT EXISTS silently accepting an incompatible table.
DO $drift$
DECLARE
  expected_cols TEXT[] := ARRAY[
    'id:uuid','parent_command_id:uuid','candidate_command_id:uuid',
    'human_review_id:integer','job_id:integer','idempotency_key:uuid',
    'artifact_sha256:text','state:text','execution_authorized:boolean',
    'lease_token_hash:text','lease_owner_worker_id:text',
    'lease_expires_at:timestamp with time zone','created_at:timestamp with time zone'
  ];
  actual_cols TEXT[];
  required_constraints TEXT[] := ARRAY[
    'gpt02_dev_recovery_reservations_pkey',
    'gpt02_recovery_parent_unique',
    'gpt02_recovery_candidate_unique',
    'gpt02_recovery_idempotency_unique',
    'gpt02_recovery_candidate_distinct_ck'
  ];
  actual_constraints TEXT[];
BEGIN
  SELECT ARRAY_AGG(column_name||':'||data_type ORDER BY ordinal_position)
    INTO actual_cols
    FROM information_schema.columns
    WHERE table_schema='ai_platform' AND table_name='gpt02_dev_recovery_reservations';
  IF actual_cols IS DISTINCT FROM expected_cols THEN
    RAISE EXCEPTION 'GPT02_RESERVATION_SCHEMA_DRIFT columns expected %, found %', expected_cols, actual_cols;
  END IF;
  SELECT ARRAY_AGG(conname::TEXT ORDER BY conname) INTO actual_constraints
    FROM pg_constraint WHERE conrelid='ai_platform.gpt02_dev_recovery_reservations'::regclass;
  IF NOT required_constraints <@ actual_constraints THEN
    RAISE EXCEPTION 'GPT02_RESERVATION_SCHEMA_DRIFT missing constraints';
  END IF;
END
$drift$;
ALTER TABLE ai_platform.gpt02_dev_recovery_reservations ENABLE ROW LEVEL SECURITY;
-- Prevent direct browser/Data API access. Internal server DB role is separately governed.
REVOKE ALL ON ai_platform.gpt02_dev_recovery_reservations FROM PUBLIC;
DO $roles$
DECLARE role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON ai_platform.gpt02_dev_recovery_reservations FROM %I',role_name);
    END IF;
  END LOOP;
END $roles$;
COMMENT ON TABLE ai_platform.gpt02_dev_recovery_reservations IS
  'DEV GPT02 command candidate reservations ONLY. Not a dispatch grant, execution lease, or final ACK.';
COMMIT;
