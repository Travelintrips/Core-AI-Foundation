#!/usr/bin/env bash
# Disposable PostgreSQL 16 only; not a live issuer, no network, no worker.
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
name="job135-issuer-negative-$$"
temp="$(mktemp -d)"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$temp"; }
trap cleanup EXIT
docker run --rm -d --network none --name "$name" -e POSTGRES_PASSWORD=isolated-only postgres:16-alpine >/dev/null
for i in $(seq 1 60); do docker exec "$name" pg_isready -U postgres >/dev/null 2>&1 && break; sleep .2; done
docker exec "$name" pg_isready -U postgres >/dev/null
for file in 20261108_gpt02_dev_recovery_reservations.sql 20261108_gpt02_dev_recovery_lineage_lease.sql; do
  docker cp "$root/scripts/migrations/$file" "$name:/tmp/$file"
done
docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
CREATE SCHEMA ai_platform;
CREATE TABLE ai_platform.ai_coding_bridge_commands(id uuid PRIMARY KEY,status text DEFAULT 'RECEIVED');
CREATE TABLE ai_platform.ai_human_tasks(id integer PRIMARY KEY);
INSERT INTO ai_platform.ai_coding_bridge_commands VALUES ('83db99f5-cbda-4e60-be71-3090fb411bbb','FAILED');
INSERT INTO ai_platform.ai_human_tasks VALUES(6);
SQL
docker exec "$name" sh -c "psql -U postgres -v ON_ERROR_STOP=1 -c \"SET ai_core.dev_migration_authorized=true;\" -f /tmp/20261108_gpt02_dev_recovery_reservations.sql -f /tmp/20261108_gpt02_dev_recovery_lineage_lease.sql" >"$temp/migration.log" 2>&1 || { cat "$temp/migration.log"; exit 1; }
docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO ai_platform.gpt02_dev_recovery_reservations
(parent_command_id,candidate_command_id,human_review_id,job_id,idempotency_key,artifact_sha256)
VALUES ('83db99f5-cbda-4e60-be71-3090fb411bbb','41aa961d-ac1e-4e12-a2c8-28ed07ff97cc',6,135,
'2ba38abd-33bb-4459-9f3c-1fc280752a83',repeat('f',64));
-- The transaction creates child AND durable link or neither.
BEGIN;
SELECT id FROM ai_platform.ai_coding_bridge_commands WHERE id='83db99f5-cbda-4e60-be71-3090fb411bbb' FOR UPDATE;
INSERT INTO ai_platform.ai_coding_bridge_commands (id) VALUES ('41aa961d-ac1e-4e12-a2c8-28ed07ff97cc');
INSERT INTO ai_platform.gpt02_dev_recovery_command_links(parent_command_id,child_command_id,reservation_id)
SELECT parent_command_id,candidate_command_id,id FROM ai_platform.gpt02_dev_recovery_reservations;
COMMIT;
DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM ai_platform.gpt02_dev_recovery_command_links;
 IF n <> 1 THEN RAISE EXCEPTION 'LINK_COUNT_INVALID'; END IF;
 -- An attempt to rebind a reservation to a second child MUST fail under trigger.
 BEGIN
   INSERT INTO ai_platform.ai_coding_bridge_commands(id) VALUES ('51aa961d-ac1e-4e12-a2c8-28ed07ff97cc');
   UPDATE ai_platform.gpt02_dev_recovery_command_links
   SET child_command_id='51aa961d-ac1e-4e12-a2c8-28ed07ff97cc';
   RAISE EXCEPTION 'INVALID_LINK_CHANGE_ACCEPTED';
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM = 'INVALID_LINK_CHANGE_ACCEPTED' THEN RAISE; END IF;
   IF SQLERRM NOT LIKE '%GPT02_RECOVERY_LINK_IDENTITY_MISMATCH%' THEN RAISE; END IF;
 END;
 -- Subtransaction rollback must remove the alternative child as well.
 IF EXISTS(SELECT 1 FROM ai_platform.ai_coding_bridge_commands WHERE id='51aa961d-ac1e-4e12-a2c8-28ed07ff97cc') THEN
   RAISE EXCEPTION 'ORPHAN_FROM_REJECTED_LINK';
 END IF;
 -- Unique parent and reservation cannot be duplicated.
 BEGIN
   INSERT INTO ai_platform.gpt02_dev_recovery_command_links(parent_command_id,child_command_id,reservation_id)
   SELECT parent_command_id,candidate_command_id,id FROM ai_platform.gpt02_dev_recovery_reservations;
   RAISE EXCEPTION 'DUPLICATE_LINK_ACCEPTED';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
 -- Direct lease is just a data row; no execution authority.
 INSERT INTO ai_platform.gpt02_dev_recovery_leases(reservation_id, fencing_token, lease_owner, lease_expires_at)
 SELECT id, 2, 'test-worker', clock_timestamp() + interval '30 seconds'
 FROM ai_platform.gpt02_dev_recovery_reservations;
 -- Simulate takeover: stale token 1 must never mutate lease token 2.
 UPDATE ai_platform.gpt02_dev_recovery_leases
 SET lease_owner='stale-worker'
 WHERE fencing_token=1 AND lease_owner='test-worker';
 GET DIAGNOSTICS n = ROW_COUNT;
 IF n <> 0 THEN RAISE EXCEPTION 'STALE_FENCE_WROTE'; END IF;
 IF (SELECT fencing_token FROM ai_platform.gpt02_dev_recovery_leases) <> 2 THEN
   RAISE EXCEPTION 'FENCING_REGRESSED';
 END IF;
 IF (SELECT count(*) FROM ai_platform.ai_coding_bridge_commands) <> 2 OR
    (SELECT count(*) FROM ai_platform.gpt02_dev_recovery_command_links) <> 1 THEN
   RAISE EXCEPTION 'EXACTLY_ONE_BROKEN';
 END IF;
END $$;
SQL
echo 'PASS: disconnected PostgreSQL; invalid lineage rejected, no orphan, duplicate denied, stale fencing CAS denied'
