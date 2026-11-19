-- Narrow Job 135 archival evidence; never an issuer authorization or grant.
-- Install on CST-DEV only as the owner of the archival source tables.
BEGIN;
DO $guard$
DECLARE t text;
BEGIN
 IF current_setting('ai_core.dev_migration_authorized',true) IS DISTINCT FROM 'true' THEN
  RAISE EXCEPTION 'GPT02_ARCHIVE_CENSUS_DEV_AUTH_REQUIRED';
 END IF;
 FOREACH t IN ARRAY ARRAY[
  'gpt02_dev_command_archive_20261030',
  'gpt02_legacy_commands_archive_20261105',
  'gpt02_legacy_responses_archive_20261105'
 ] LOOP
  IF to_regclass('ai_platform.'||t) IS NULL OR
   NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=to_regclass('ai_platform.'||t)
     AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) OR
   has_table_privilege('aicore_dev_runtime',to_regclass('ai_platform.'||t),'SELECT')
   THEN RAISE EXCEPTION 'GPT02_ARCHIVE_CENSUS_OWNERSHIP_OR_GRANT_DRIFT:%',t;
  END IF;
 END LOOP;
END $guard$;

-- Fixed subject: cannot leak arbitrary historical commands through user input.
-- All counts from a single MVCC snapshot and do not expose instructions.
CREATE OR REPLACE FUNCTION ai_platform.gpt02_dev_job135_archive_census()
RETURNS TABLE (
  parent_present boolean,
  parent_created_at timestamptz,
  old_archive_total bigint,
  legacy_command_total bigint,
  legacy_response_total bigint,
  archive_parent_tag_matches bigint,
  archives_created_after_parent bigint,
  historical_sources_covered integer,
  legacy_untagged_attempts_excluded boolean,
  may_create_command boolean,
  may_dispatch_worker boolean,
  may_close_job boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,ai_platform
AS $body$
 WITH parent AS (
  SELECT created_at FROM ai_platform.ai_coding_bridge_commands
  WHERE id='83db99f5-cbda-4e60-be71-3090fb411bbb'::uuid
 ), a AS (
  SELECT count(*) AS n, count(*) FILTER(
   WHERE command_record::text LIKE '%83db99f5-cbda-4e60-be71-3090fb411bbb%'
  ) AS tagged,
  count(*) FILTER(WHERE archived_at >= (SELECT created_at FROM parent)) AS later
  FROM ai_platform.gpt02_dev_command_archive_20261030
 ), b AS (
  SELECT count(*) AS n, count(*) FILTER(
   WHERE metadata_json::text LIKE '%83db99f5-cbda-4e60-be71-3090fb411bbb%'
  ) AS tagged,
  count(*) FILTER(WHERE created_at >= (SELECT created_at FROM parent)) AS later
  FROM ai_platform.gpt02_legacy_commands_archive_20261105
 ), c AS (
  SELECT count(*) AS n,
    count(*) FILTER(WHERE created_at >= (SELECT created_at FROM parent)) AS later
  FROM ai_platform.gpt02_legacy_responses_archive_20261105
 )
 SELECT EXISTS(SELECT 1 FROM parent), (SELECT created_at FROM parent),
  a.n,b.n,c.n,a.tagged+b.tagged,a.later+b.later+c.later,3,
  FALSE,FALSE,FALSE,FALSE
 FROM a CROSS JOIN b CROSS JOIN c
$body$;
REVOKE ALL ON FUNCTION ai_platform.gpt02_dev_job135_archive_census() FROM PUBLIC;
DO $revoke$
DECLARE r text;
BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
  EXECUTE format('REVOKE ALL ON FUNCTION ai_platform.gpt02_dev_job135_archive_census() FROM %I',r);
 END IF;
 END LOOP;
END $revoke$;
GRANT EXECUTE ON FUNCTION ai_platform.gpt02_dev_job135_archive_census() TO aicore_dev_runtime;
COMMIT;
