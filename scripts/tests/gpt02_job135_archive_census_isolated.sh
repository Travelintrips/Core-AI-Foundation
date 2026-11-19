#!/usr/bin/env bash
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
name="gpt02-archive-census-$$"
temp="$(mktemp -d)"
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || :; rm -rf "$temp"; }
trap cleanup EXIT
docker run -d --rm --network none --name "$name" -e POSTGRES_PASSWORD=test_only postgres:16-alpine >/dev/null
for n in $(seq 1 100);do
 if docker exec "$name" pg_isready -U postgres >/dev/null 2>&1;then break;fi
 sleep .3
done
docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL' >"$temp/bootstrap"
CREATE SCHEMA ai_platform;
CREATE ROLE aicore_dev_runtime NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE rogue NOLOGIN;
GRANT USAGE ON SCHEMA ai_platform TO aicore_dev_runtime,anon,authenticated,rogue;
CREATE TABLE ai_platform.ai_coding_bridge_commands(id uuid PRIMARY KEY, created_at timestamptz NOT NULL);
INSERT INTO ai_platform.ai_coding_bridge_commands VALUES
('83db99f5-cbda-4e60-be71-3090fb411bbb','2026-11-07T18:56:09Z');
CREATE TABLE ai_platform.gpt02_dev_command_archive_20261030(command_record jsonb,archived_at timestamptz);
CREATE TABLE ai_platform.gpt02_legacy_commands_archive_20261105(metadata_json jsonb,created_at timestamptz);
CREATE TABLE ai_platform.gpt02_legacy_responses_archive_20261105(created_at timestamptz);
INSERT INTO ai_platform.gpt02_dev_command_archive_20261030 VALUES ('{}','2026-10-30');
INSERT INTO ai_platform.gpt02_legacy_commands_archive_20261105 VALUES ('{}','2026-10-25');
INSERT INTO ai_platform.gpt02_legacy_responses_archive_20261105 VALUES ('2026-10-25');
SQL
file=20261109_gpt02_job135_archive_census.sql
docker cp "$root/scripts/migrations/$file" "$name:/tmp/$file"
if docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -f "/tmp/$file" >"$temp/noauth" 2>&1;then echo 'FAIL: unauthorized migration succeeded';exit 1;fi
grep -q 'GPT02_ARCHIVE_CENSUS_DEV_AUTH_REQUIRED' "$temp/noauth"
for n in 1 2;do
 docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -c "SET ai_core.dev_migration_authorized=true" -f "/tmp/$file" >"$temp/approved-$n" 2>&1 || { cat "$temp/approved-$n";exit 1; }
done
docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL' >"$temp/verify"
DO $$
BEGIN
 IF NOT has_function_privilege('aicore_dev_runtime','ai_platform.gpt02_dev_job135_archive_census()','EXECUTE')
 OR has_function_privilege('anon','ai_platform.gpt02_dev_job135_archive_census()','EXECUTE')
 OR has_function_privilege('authenticated','ai_platform.gpt02_dev_job135_archive_census()','EXECUTE')
 OR has_table_privilege('aicore_dev_runtime','ai_platform.gpt02_dev_command_archive_20261030','SELECT')
 THEN RAISE EXCEPTION 'GRANT_DRIFT'; END IF;
END $$;
SET ROLE aicore_dev_runtime;
DO $$
DECLARE r record;
BEGIN
 SELECT * INTO r FROM ai_platform.gpt02_dev_job135_archive_census();
 IF NOT r.parent_present OR r.old_archive_total<>1 OR r.legacy_command_total<>1
 OR r.legacy_response_total<>1 OR r.archives_created_after_parent<>0
 OR r.archive_parent_tag_matches<>0 OR r.legacy_untagged_attempts_excluded
 OR r.may_create_command OR r.may_dispatch_worker OR r.may_close_job
 THEN RAISE EXCEPTION 'ARCHIVE_CENSUS_MISMATCH'; END IF;
END $$;
RESET ROLE;
INSERT INTO ai_platform.gpt02_legacy_commands_archive_20261105
VALUES ('{"recoveryParentCommandId":"83db99f5-cbda-4e60-be71-3090fb411bbb"}','2026-11-08T10:00:00Z');
SET ROLE aicore_dev_runtime;
DO $$
DECLARE r record;
BEGIN
 SELECT * INTO r FROM ai_platform.gpt02_dev_job135_archive_census();
 IF r.legacy_command_total<>2 OR r.archive_parent_tag_matches<>1
 OR r.archives_created_after_parent<>1 OR r.legacy_untagged_attempts_excluded
 OR r.may_create_command THEN RAISE EXCEPTION 'CONFLICT_FAILED_CLOSED'; END IF;
END $$;
SQL
echo 'PASS: isolated PG16 archive census, authorized owner migration twice, runtime narrow EXECUTE, public denied, conflicts remain non-authorizing'
