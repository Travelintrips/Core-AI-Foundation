#!/usr/bin/env bash
# DEV TEST FIXTURE ONLY: disposable PostgreSQL, never connects to existing DB.
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
name="job135-issuer-test-$$"
tmp="$(mktemp -d)"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT
docker run -d --rm --name "$name" --network none -e POSTGRES_PASSWORD=isolated_only postgres:16-alpine >/dev/null
for i in $(seq 1 30); do
  if docker exec "$name" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep .2
done
docker exec "$name" pg_isready -U postgres >/dev/null
for f in 20261108_gpt02_dev_recovery_reservations.sql 20261108_gpt02_dev_recovery_lineage_lease.sql; do
  docker cp "$root/scripts/migrations/$f" "$name:/tmp/$f"
done
docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
CREATE SCHEMA ai_platform;
CREATE TABLE ai_platform.ai_coding_bridge_commands(id uuid PRIMARY KEY,status text DEFAULT 'RECEIVED');
CREATE TABLE ai_platform.ai_human_tasks(id integer PRIMARY KEY);
INSERT INTO ai_platform.ai_coding_bridge_commands(id,status) VALUES('83db99f5-cbda-4e60-be71-3090fb411bbb','FAILED');
INSERT INTO ai_platform.ai_human_tasks VALUES(6);
SQL
if ! docker exec "$name" sh -c "psql -U postgres -v ON_ERROR_STOP=1 -c 'SET ai_core.dev_migration_authorized=true;' -f /tmp/20261108_gpt02_dev_recovery_reservations.sql -f /tmp/20261108_gpt02_dev_recovery_lineage_lease.sql" > "$tmp/migrations.log" 2>&1; then cat "$tmp/migrations.log"; exit 1; fi
docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -c "
INSERT INTO ai_platform.gpt02_dev_recovery_reservations
(parent_command_id,candidate_command_id,human_review_id,job_id,idempotency_key,artifact_sha256)
VALUES('83db99f5-cbda-4e60-be71-3090fb411bbb',
'41aa961d-ac1e-4e12-a2c8-28ed07ff97cc',6,135,
'2ba38abd-33bb-4459-9f3c-1fc280752a83',repeat('f',64));" >/dev/null
cat > "$tmp/A.sql" <<'SQL'
\set ON_ERROR_STOP on
BEGIN;
SELECT id FROM ai_platform.ai_coding_bridge_commands
WHERE id='83db99f5-cbda-4e60-be71-3090fb411bbb' FOR UPDATE;
INSERT INTO ai_platform.ai_coding_bridge_commands(id)
VALUES('41aa961d-ac1e-4e12-a2c8-28ed07ff97cc') ON CONFLICT DO NOTHING RETURNING id;
INSERT INTO ai_platform.gpt02_dev_recovery_command_links(parent_command_id,child_command_id,reservation_id)
SELECT parent_command_id,candidate_command_id,id
FROM ai_platform.gpt02_dev_recovery_reservations
WHERE parent_command_id='83db99f5-cbda-4e60-be71-3090fb411bbb'
ON CONFLICT DO NOTHING RETURNING child_command_id;
SELECT pg_sleep(1);
COMMIT;
SQL
cat > "$tmp/B.sql" <<'SQL'
\set ON_ERROR_STOP on
BEGIN;
SELECT id FROM ai_platform.ai_coding_bridge_commands
WHERE id='83db99f5-cbda-4e60-be71-3090fb411bbb' FOR UPDATE;
INSERT INTO ai_platform.ai_coding_bridge_commands(id)
SELECT '41aa961d-ac1e-4e12-a2c8-28ed07ff97cc'::uuid
WHERE NOT EXISTS(SELECT 1 FROM ai_platform.gpt02_dev_recovery_command_links
WHERE parent_command_id='83db99f5-cbda-4e60-be71-3090fb411bbb')
ON CONFLICT DO NOTHING RETURNING id;
COMMIT;
SQL
docker cp "$tmp/A.sql" "$name:/tmp/A.sql"
docker cp "$tmp/B.sql" "$name:/tmp/B.sql"
(docker exec "$name" psql -U postgres -f /tmp/A.sql > "$tmp/A.log" 2>&1) &
first=$!
sleep .2
(docker exec "$name" psql -U postgres -f /tmp/B.sql > "$tmp/B.log" 2>&1) &
second=$!
wait "$first"
wait "$second"
grep -q 'INSERT 0 1' "$tmp/A.log"
grep -q 'INSERT 0 0' "$tmp/B.log"
cat > "$tmp/rollback.sql" <<'SQL'
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO ai_platform.ai_coding_bridge_commands(id) VALUES('a1aa961d-ac1e-4e12-a2c8-28ed07ff97cc');
ROLLBACK;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM ai_platform.ai_coding_bridge_commands WHERE id='a1aa961d-ac1e-4e12-a2c8-28ed07ff97cc')
 THEN RAISE EXCEPTION 'ROLLBACK_LEFT_ORPHAN'; END IF;
 IF (SELECT count(*) FROM ai_platform.ai_coding_bridge_commands WHERE id='41aa961d-ac1e-4e12-a2c8-28ed07ff97cc')<>1
 OR (SELECT count(*) FROM ai_platform.gpt02_dev_recovery_command_links WHERE parent_command_id='83db99f5-cbda-4e60-be71-3090fb411bbb')<>1
 THEN RAISE EXCEPTION 'ATOMIC_LINEAGE_COUNT_DRIFT'; END IF;
END $$;
SQL
docker cp "$tmp/rollback.sql" "$name:/tmp/rollback.sql"
docker exec "$name" psql -U postgres -f /tmp/rollback.sql > "$tmp/rollback.log" 2>&1
echo 'PASS: isolated PostgreSQL parent-locked competition A=1, B=0, child=1, link=1, rollback orphan=0'
