-- CST-DEV GATE A PROPOSED DATA MODEL ONLY. NEVER APPLY TO LIVE SUPABASE
-- WITHOUT A SEPARATELY AUTHORIZED, REVIEWED CHANGE.
--
-- Exactly one lease row per CST-DEV project. This is NOT an approval,
-- not a LOGIN grant, not a signed Operations release and not an admin role.
-- No Data API, application or watcher permissions are granted here.
-- Existing GPT02 recovery leases/roles and all production data stay untouched.
BEGIN;
DO $guard$
BEGIN
  -- This session marker is for isolated QA/migration scripting only. It
  -- is NOT proof of Owner or Operations authority, nor a security boundary.
  IF current_setting('cst_gatea.reviewed_dev_migration', true) IS DISTINCT FROM 'true'
     OR to_regnamespace('ai_platform') IS NULL THEN
    RAISE EXCEPTION 'CST_GATEA_PROPOSED_MIGRATION_REVIEW_REQUIRED';
  END IF;
  -- Never accept a drifted preexisting relation via IF NOT EXISTS.
  IF to_regclass('ai_platform.cst_gatea_stage_leases') IS NOT NULL THEN
    RAISE EXCEPTION 'CST_GATEA_STAGE_LEASE_TABLE_ALREADY_EXISTS_REVIEW_REQUIRED';
  END IF;
END $guard$;

CREATE TABLE ai_platform.cst_gatea_stage_leases (
  project text PRIMARY KEY
    CONSTRAINT gatea_exact_dev_project
      CHECK (project='xssrfshdrtdfupgqwfdw'),
  nonce text NOT NULL
    CONSTRAINT gatea_signed_nonce_format
      CHECK (nonce ~ '^[0-9a-f]{32}$'),
  source_sha text NOT NULL
    CONSTRAINT gatea_source_hash_format
      CHECK (source_sha ~ '^[0-9a-f]{40}$'),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL,
  state text NOT NULL
    CONSTRAINT gatea_state_scope
      CHECK (state IN ('ACTIVE','CLOSED')),
  CONSTRAINT gatea_bounded_ten_minute_lease
    CHECK (issued_at < expires_at
       AND expires_at <= issued_at + interval '10 minutes'),
  CONSTRAINT gatea_heartbeat_within_window
    CHECK (heartbeat_at >= issued_at AND heartbeat_at <= expires_at)
);
ALTER TABLE ai_platform.cst_gatea_stage_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.cst_gatea_stage_leases FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ai_platform.cst_gatea_stage_leases FROM PUBLIC;

-- A future separately reviewed operations change must create a strictly
-- scoped reader policy and writer policy. This candidate intentionally
-- creates NO policy, GRANT, role, password, LOGIN or SECURITY DEFINER.
-- A PostgreSQL superuser in disposable QA is not an operational credential.
COMMIT;
