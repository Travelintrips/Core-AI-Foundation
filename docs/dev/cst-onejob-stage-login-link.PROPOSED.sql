-- PROPOSED ONLY; NEVER APPLY UNTIL APPROVED AND TESTED ON CST-DEV.
-- No password, login enablement, role assumption by Core AI shared pool
-- or RLS mutation. The dedicated writer remains NOLOGIN.
--
-- PostgreSQL 16 supports membership option SET TRUE, INHERIT FALSE.
-- Distinct stage_login will eventually be configured via independently
-- provisioned, short-lived DB credentials; user Owner does NOT log in again.
CREATE ROLE cst_team_model_pilot_stage_login NOLOGIN NOINHERIT
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 1;
GRANT cst_team_model_pilot_writer TO cst_team_model_pilot_stage_login
  WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;

-- DO NOT GRANT writer to aicore_dev_runtime or any production role.
-- Role cst_team_model_pilot_stage_login has NO direct table/sequence grants,
-- NO BYPASSRLS, NO CREATEROLE, and cannot SELECT/INSERT until
-- SET LOCAL ROLE cst_team_model_pilot_writer within a BEGIN transaction.
-- PostgreSQL automatically clears SET LOCAL when it commits or rolls back.
-- Enabling LOGIN and installing password in Supabase DEV is a SEPARATE
-- reviewed, one-time setup using a secret manager; NO secrets in GitHub.
-- Connection URL must be constrained to the pinned DEV project and
-- transaction pooler 6543 with sslmode=verify-full. Never grant public/API
-- access, and never use the existing @workspace/db shared connection pool.
