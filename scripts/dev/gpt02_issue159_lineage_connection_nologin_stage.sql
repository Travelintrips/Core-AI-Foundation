-- CST-DEV ONLY. Stage dedicated lineage connection identity with NOLOGIN.
-- Separate migration from owner-scoped SELECT policies; zero operational access.
BEGIN;
DO $$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM pg_catalog.pg_roles
   WHERE rolname='dev_gpt02_lineage_reader'
     AND NOT rolcanlogin AND NOT rolbypassrls
 ) THEN RAISE EXCEPTION 'READER_NOLOGIN_PREREQUISITE_FAILED'; END IF;
 IF EXISTS (
   SELECT 1 FROM pg_catalog.pg_roles
   WHERE rolname='dev_gpt02_lineage_login'
 ) THEN RAISE EXCEPTION 'LINEAGE_CONNECTION_ROLE_ALREADY_EXISTS'; END IF;
 IF NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_auth_members m
  JOIN pg_catalog.pg_roles r ON r.oid=m.roleid
  JOIN pg_catalog.pg_roles u ON u.oid=m.member
  WHERE r.rolname='dev_gpt02_lineage_reader'
    AND u.rolname=current_user AND m.admin_option
 ) THEN RAISE EXCEPTION 'READER_MEMBERSHIP_ADMIN_REQUIRED'; END IF;
END $$;
CREATE ROLE dev_gpt02_lineage_login
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS INHERIT;
GRANT dev_gpt02_lineage_reader TO dev_gpt02_lineage_login
  WITH INHERIT TRUE, SET FALSE;
DO $$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM pg_catalog.pg_roles
   WHERE rolname='dev_gpt02_lineage_login'
    AND NOT rolcanlogin AND NOT rolbypassrls
    AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb
 ) THEN RAISE EXCEPTION 'LINEAGE_CONNECTION_STANDBY_DENIED'; END IF;
 IF NOT EXISTS (
   SELECT 1 FROM pg_catalog.pg_auth_members m
   JOIN pg_catalog.pg_roles reader ON reader.oid=m.roleid
   JOIN pg_catalog.pg_roles login ON login.oid=m.member
   WHERE reader.rolname='dev_gpt02_lineage_reader'
     AND login.rolname='dev_gpt02_lineage_login'
     AND m.inherit_option AND NOT m.set_option
 ) THEN RAISE EXCEPTION 'LINEAGE_READ_ONLY_INHERITANCE_INVALID'; END IF;
END $$;
COMMIT;
-- Never grant LOGIN here or provision secrets in SQL.
