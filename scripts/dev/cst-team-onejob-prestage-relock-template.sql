-- Two-phase cleanup for one-job pre-staging (CST-DEV ONLY).
-- IMPORTANT: relock stage LOGIN immediately after one WAITING job is committed.
-- Keep scoped Owner SELECT until Owner confirms or job expires. Final cleanup
-- removes only this temporary role and its policies; active index is retained.
-- TEMPLATE ONLY: never execute raw placeholders against PROD.
DO $guard$
BEGIN
 IF current_database()<>'{{EXPECTED_DATABASE}}'
    OR '{{EXPECTED_DATABASE}}'<>'postgres'
    OR '{{PRESTAGE_ROLE}}' !~ '^cst_team_onejob_prestage_[0-9]{8}_[a-f0-9]{8}$'
    OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='{{PRESTAGE_ROLE}}')
 THEN RAISE EXCEPTION 'CST_ONEJOB_PRESTAGE_RELOCK_WRONG_DB_OR_ROLE'; END IF;
END $guard$;
ALTER ROLE {{PRESTAGE_ROLE}} NOLOGIN PASSWORD NULL;
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
 WHERE usename='{{PRESTAGE_ROLE}}' AND pid<>pg_backend_pid();
DO $guard$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='{{PRESTAGE_ROLE}}' AND rolcanlogin)
 THEN RAISE EXCEPTION 'CST_ONEJOB_PRESTAGE_LOGIN_STILL_ACTIVE'; END IF;
END $guard$;
