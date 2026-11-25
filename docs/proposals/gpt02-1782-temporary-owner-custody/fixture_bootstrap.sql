-- SYNTHETIC ISOLATED CLUSTER ONLY. Never run against CST DEV or another database.
-- The initdb bootstrap superuser is fixture_bootstrap, NOT postgres.
CREATE ROLE postgres LOGIN NOSUPERUSER CREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS;
GRANT CONNECT, TEMPORARY ON DATABASE postgres TO postgres;
CREATE ROLE gpt02_owner_ledger_reader_dev NOLOGIN;

-- BEGIN_DIRECT_POSTGRES_ROLE_SETUP
SET createrole_self_grant = '';
CREATE ROLE gpt02_relock_owner_approval_owner
  NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
CREATE ROLE gpt02_owner_ledger_reader_1782_dev
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
  NOBYPASSRLS NOINHERIT CONNECTION LIMIT 1 VALID UNTIL '1970-01-01T00:00:00Z';
ALTER ROLE gpt02_owner_ledger_reader_1782_dev SET default_transaction_read_only = on;
-- END_DIRECT_POSTGRES_ROLE_SETUP

CREATE SCHEMA gpt02_owner_approval AUTHORIZATION gpt02_relock_owner_approval_owner;
CREATE TABLE gpt02_owner_approval.gpt02_relock_owner_approval_challenges (
  id uuid, status text, manifest_sha256 text, manifest_json jsonb,
  consumed_at timestamptz, expires_at timestamptz, scope text,
  environment text, project_id text, worker_principal text, owner_email text,
  owner_auth_supabase_id uuid, owner_subject text, issued_at timestamptz,
  never_granted_private text
);
CREATE TABLE gpt02_owner_approval.gpt02_relock_owner_approval_decisions (
  challenge_id uuid, decision text, decided_at timestamptz, approval_method text,
  owner_email text, owner_auth_supabase_id uuid, owner_subject text,
  scope text, worker_principal text, manifest_sha256 text, never_granted_private text
);
ALTER TABLE gpt02_owner_approval.gpt02_relock_owner_approval_challenges
  OWNER TO gpt02_relock_owner_approval_owner;
ALTER TABLE gpt02_owner_approval.gpt02_relock_owner_approval_decisions
  OWNER TO gpt02_relock_owner_approval_owner;
ALTER TABLE gpt02_owner_approval.gpt02_relock_owner_approval_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_owner_approval.gpt02_relock_owner_approval_challenges FORCE ROW LEVEL SECURITY;
ALTER TABLE gpt02_owner_approval.gpt02_relock_owner_approval_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_owner_approval.gpt02_relock_owner_approval_decisions FORCE ROW LEVEL SECURITY;

-- Preserve independent old-reader ACLs/policy throughout both success and failure.
GRANT USAGE ON SCHEMA gpt02_owner_approval TO gpt02_owner_ledger_reader_dev;
GRANT SELECT (id, status) ON gpt02_owner_approval.gpt02_relock_owner_approval_challenges
  TO gpt02_owner_ledger_reader_dev;
CREATE POLICY fixture_task190_policy ON gpt02_owner_approval.gpt02_relock_owner_approval_challenges
  FOR SELECT TO gpt02_owner_ledger_reader_dev USING (scope = 'TASK190_FIXTURE_ONLY');

INSERT INTO gpt02_owner_approval.gpt02_relock_owner_approval_challenges
  (id,status,scope,environment,project_id,worker_principal,owner_email,never_granted_private)
VALUES
  ('9c4f21e1-48af-4f7f-9830-931b84e3e846','CONSUMED','GPT02_RELOCK_CST_DEV','DEV',
   'xssrfshdrtdfupgqwfdw','openclaw-vps-main','admcst001@gmail.com','SYNTHETIC_ONLY'),
  ('00000000-0000-4000-8000-000000000001','CONSUMED','GPT02_RELOCK_CST_DEV','DEV',
   'xssrfshdrtdfupgqwfdw','openclaw-vps-main','admcst001@gmail.com','SYNTHETIC_ONLY'),
  ('9c4f21e1-48af-4f7f-9830-931b84e3e846','CONSUMED','GPT02_RELOCK_CST_DEV','PROD',
   'xssrfshdrtdfupgqwfdw','openclaw-vps-main','admcst001@gmail.com','SYNTHETIC_ONLY');
INSERT INTO gpt02_owner_approval.gpt02_relock_owner_approval_decisions
  (challenge_id,decision,scope,worker_principal,owner_email,never_granted_private)
VALUES
  ('9c4f21e1-48af-4f7f-9830-931b84e3e846','APPROVED','GPT02_RELOCK_CST_DEV',
   'openclaw-vps-main','admcst001@gmail.com','SYNTHETIC_ONLY'),
  ('00000000-0000-4000-8000-000000000001','APPROVED','GPT02_RELOCK_CST_DEV',
   'openclaw-vps-main','admcst001@gmail.com','SYNTHETIC_ONLY'),
  ('9c4f21e1-48af-4f7f-9830-931b84e3e846','REJECTED','GPT02_RELOCK_CST_DEV',
   'openclaw-vps-main','admcst001@gmail.com','SYNTHETIC_ONLY');
