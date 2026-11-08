#!/usr/bin/env bash
# Disposable PostgreSQL only; never connects to live DEV or PROD.
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
name="job135-reader-test-$$"
tmp="$(mktemp -d)"
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT
docker run -d --rm --network none --name "$name" -e POSTGRES_PASSWORD=isolated_only postgres:16-alpine >/dev/null
ready=false
for i in $(seq 1 120); do
 if docker exec "$name" pg_isready -U postgres >/dev/null 2>&1; then ready=true;break;fi
 sleep .25
done
if [ "$ready" != true ]; then echo "ISOLATED_POSTGRES_NOT_READY";exit 1;fi
# Initial postgres bootstrap may briefly return pg_isready before server restart.
for i in $(seq 1 30); do
 if docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -Atc "SELECT 1" >/dev/null 2>&1; then break;fi
 sleep .25
done
sleep .8
docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
CREATE SCHEMA ai_platform;
CREATE ROLE aicore_dev_runtime NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
GRANT USAGE ON SCHEMA ai_platform TO aicore_dev_runtime,anon,authenticated;
CREATE TABLE ai_platform.ai_coding_bridge_commands(id uuid PRIMARY KEY);
CREATE TABLE ai_platform.ai_human_tasks(id integer PRIMARY KEY,source_module text,payload_json jsonb);
INSERT INTO ai_platform.ai_coding_bridge_commands(id) VALUES
 ('83db99f5-cbda-4e60-be71-3090fb411bbb');
INSERT INTO ai_platform.ai_human_tasks(id,source_module,payload_json)
VALUES (6,'ai_core_lifecycle',
 '{"commandId":"83db99f5-cbda-4e60-be71-3090fb411bbb","taskId":"135"}');
SQL
for f in 20261108_gpt02_dev_recovery_reservations.sql 20261108_gpt02_dev_timeline_candidate_reader.sql; do
 docker cp "$root/scripts/migrations/$f" "$name:/tmp/$f"
done
# Unauthorized migration must fail BEFORE creating function.
if docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/20261108_gpt02_dev_timeline_candidate_reader.sql > "$tmp/negative.log" 2>&1; then
 echo 'FAIL: unguarded migration passed';exit 1
fi
grep -q 'GPT02_DEV_MIGRATION_AUTHORIZATION_REQUIRED' "$tmp/negative.log"
docker exec "$name" sh -c "psql -U postgres -v ON_ERROR_STOP=1 -c 'SET ai_core.dev_migration_authorized=true' -f /tmp/20261108_gpt02_dev_recovery_reservations.sql -f /tmp/20261108_gpt02_dev_timeline_candidate_reader.sql -f /tmp/20261108_gpt02_dev_timeline_candidate_reader.sql" > "$tmp/positive.log" 2>&1 || { cat "$tmp/positive.log";exit 1; }
# An attacker with schema CREATE but no table ownership cannot create the
# SECURITY DEFINER reader, even if they set the migration session flag.
docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
CREATE ROLE rogue_migrator NOLOGIN;
GRANT USAGE, CREATE ON SCHEMA ai_platform TO rogue_migrator;
SQL
if docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1  -c "SET ROLE rogue_migrator; SET ai_core.dev_migration_authorized=true"  -f /tmp/20261108_gpt02_dev_timeline_candidate_reader.sql > "$tmp/rogue.log" 2>&1; then
 echo 'FAIL: nonowner migration passed';exit 1
fi
grep -q 'GPT02_TIMELINE_MIGRATION_OWNER_OR_RLS_MISMATCH' "$tmp/rogue.log" || { tail -18 "$tmp/rogue.log";exit 1; }
docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL' > "$tmp/check.log"
INSERT INTO ai_platform.gpt02_dev_recovery_reservations
 (parent_command_id,candidate_command_id,human_review_id,job_id,idempotency_key,artifact_sha256)
VALUES ('83db99f5-cbda-4e60-be71-3090fb411bbb',
 '41aa961d-ac1e-4e12-a2c8-28ed07ff97cc',6,135,
 '2ba38abd-33bb-4459-9f3c-1fc280752a83',repeat('f',64));
DO $priv$
BEGIN
 IF has_function_privilege('anon',
  'ai_platform.gpt02_dev_timeline_candidate_reader(integer,integer,uuid)','EXECUTE')
  OR has_function_privilege('authenticated',
  'ai_platform.gpt02_dev_timeline_candidate_reader(integer,integer,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'PUBLIC_OR_BROWSER_READER_GRANT'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class
  WHERE oid='ai_platform.gpt02_dev_recovery_reservations'::regclass)
 THEN RAISE EXCEPTION 'RESERVATION_RLS_DISABLED'; END IF;
END $priv$;
SET ROLE aicore_dev_runtime;
DO $verify$
DECLARE n integer;
BEGIN
 IF has_table_privilege(current_user,'ai_platform.gpt02_dev_recovery_reservations','SELECT')
 THEN RAISE EXCEPTION 'BROAD_TABLE_SELECT_GRANTED'; END IF;
 IF NOT has_function_privilege(current_user,
 'ai_platform.gpt02_dev_timeline_candidate_reader(integer,integer,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'NARROW_READER_UNAVAILABLE'; END IF;
 SELECT count(*) INTO n FROM ai_platform.gpt02_dev_timeline_candidate_reader(
  6,135,'83db99f5-cbda-4e60-be71-3090fb411bbb');
 IF n<>1 THEN RAISE EXCEPTION 'MATCHING_REVIEW_NOT_READABLE'; END IF;
 SELECT count(*) INTO n FROM ai_platform.gpt02_dev_timeline_candidate_reader(
  7,135,'83db99f5-cbda-4e60-be71-3090fb411bbb');
 IF n<>0 THEN RAISE EXCEPTION 'CROSS_REVIEW_LEAK'; END IF;
 SELECT count(*) INTO n FROM ai_platform.gpt02_dev_timeline_candidate_reader(
  6,136,'83db99f5-cbda-4e60-be71-3090fb411bbb');
 IF n<>0 THEN RAISE EXCEPTION 'CROSS_JOB_LEAK'; END IF;
 SELECT count(*) INTO n FROM ai_platform.gpt02_dev_timeline_candidate_reader(
  6,135,'a1aa961d-ac1e-4e12-a2c8-28ed07ff97cc');
 IF n<>0 THEN RAISE EXCEPTION 'CROSS_PARENT_LEAK'; END IF;
END $verify$;
SQL
echo 'PASS: isolated migration twice, unauthorized and nonowner guards denied, runtime SELECT denied, bound candidate available, cross-review/job/parent and browser roles denied'
