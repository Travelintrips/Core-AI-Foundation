#!/usr/bin/env bash
# Isolated PostgreSQL 16 only; NEVER touches DEV or PROD.
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
name="job135-ledger-bundle-$$"
temp="$(mktemp -d)"
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || :;rm -rf "$temp"; }
trap cleanup EXIT
docker run -d --rm --network none --name "$name" -e POSTGRES_PASSWORD=isolated_only postgres:16-alpine >/dev/null
ready=false
for i in $(seq 1 120);do
 if docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -Atc 'SELECT 1' >/dev/null 2>&1;then ready=true;break;fi
 sleep .25
done
if [[ "$ready" != true ]];then echo 'FAIL: isolated postgres did not start';exit 1;fi
# PostgreSQL image can briefly accept connections before its bootstrap restart.
stable=false
for i in $(seq 1 60);do
 if docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -Atc 'SELECT 1' >/dev/null 2>&1;then
   sleep .3
   if docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -Atc 'SELECT 1' >/dev/null 2>&1;then stable=true;break;fi
 fi
 sleep .3
done
if [[ "$stable" != true ]];then echo 'FAIL: postgres bootstrap unstable';exit 1;fi
sleep 1
docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
CREATE SCHEMA ai_platform;
CREATE ROLE aicore_dev_runtime NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE rogue_migrator NOLOGIN;
GRANT USAGE ON SCHEMA ai_platform TO aicore_dev_runtime,anon,authenticated;
GRANT USAGE,CREATE ON SCHEMA ai_platform TO rogue_migrator;
CREATE TABLE ai_platform.ai_coding_bridge_commands(id uuid PRIMARY KEY);
CREATE TABLE ai_platform.ai_human_tasks(id integer PRIMARY KEY);
INSERT INTO ai_platform.ai_coding_bridge_commands(id) VALUES
 ('83db99f5-cbda-4e60-be71-3090fb411bbb'),
 ('41aa961d-ac1e-4e12-a2c8-28ed07ff97cc'),
 ('a1aa961d-ac1e-4e12-a2c8-28ed07ff97cc');
INSERT INTO ai_platform.ai_human_tasks(id) VALUES(6);
SQL
for file in 20261108_gpt02_dev_recovery_reservations.sql 20261108_gpt02_dev_recovery_lineage_lease.sql 20261108_gpt02_dev_recovery_release_receipts.sql;do
 docker cp "$root/scripts/migrations/$file" "$name:/tmp/$file"
done
# The prerequisite was separately reviewed and applied in the live DEV DB;
# this fixture installs it to establish realistic ownership and RLS.
docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -c "SET ai_core.dev_migration_authorized=true" -f /tmp/20261108_gpt02_dev_recovery_reservations.sql >"$temp/prereq" 2>&1
for file in 20261108_gpt02_dev_recovery_lineage_lease.sql 20261108_gpt02_dev_recovery_release_receipts.sql;do
 if docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -f "/tmp/$file" > "$temp/no-flag" 2>&1;then
   echo "FAIL: unauthorized migration passed $file";exit 1
 fi
 grep -q GPT02_DEV_MIGRATION_AUTHORIZATION_REQUIRED "$temp/no-flag"
 if docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -c "SET ROLE rogue_migrator; SET ai_core.dev_migration_authorized=true" -f "/tmp/$file" > "$temp/rogue" 2>&1;then
   echo "FAIL: non-owner migration passed $file";exit 1
 fi
 grep -q GPT02_RECOVERY_LEDGER_MIGRATION_OWNER_OR_RLS_MISMATCH "$temp/rogue" || { tail -20 "$temp/rogue";exit 1; }
done
for i in 1 2;do
 docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -c "SET ai_core.dev_migration_authorized=true" -f /tmp/20261108_gpt02_dev_recovery_lineage_lease.sql -f /tmp/20261108_gpt02_dev_recovery_release_receipts.sql > "$temp/apply-$i" 2>&1 || { cat "$temp/apply-$i";exit 1; }
done
docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL' > "$temp/test"
INSERT INTO ai_platform.gpt02_dev_recovery_reservations
(parent_command_id,candidate_command_id,human_review_id,job_id,idempotency_key,artifact_sha256)
VALUES ('83db99f5-cbda-4e60-be71-3090fb411bbb',
'41aa961d-ac1e-4e12-a2c8-28ed07ff97cc',6,135,
'2ba38abd-33bb-4459-9f3c-1fc280752a83',repeat('f',64));
DO $check$
DECLARE rid uuid;
BEGIN
 SELECT id INTO rid FROM ai_platform.gpt02_dev_recovery_reservations LIMIT 1;
 -- A candidate link cannot point at a different child.
 BEGIN
  INSERT INTO ai_platform.gpt02_dev_recovery_command_links
  (parent_command_id,child_command_id,reservation_id)
  VALUES('83db99f5-cbda-4e60-be71-3090fb411bbb',
  'a1aa961d-ac1e-4e12-a2c8-28ed07ff97cc',rid);
  RAISE EXCEPTION 'WRONG_CHILD_WAS_ACCEPTED';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'GPT02_RECOVERY_LINK_IDENTITY_MISMATCH' THEN RAISE; END IF;
 END;
 INSERT INTO ai_platform.gpt02_dev_recovery_command_links
 (parent_command_id,child_command_id,reservation_id)
 VALUES('83db99f5-cbda-4e60-be71-3090fb411bbb',
 '41aa961d-ac1e-4e12-a2c8-28ed07ff97cc',rid);
 INSERT INTO ai_platform.gpt02_dev_recovery_leases(reservation_id)VALUES(rid);
 UPDATE ai_platform.gpt02_dev_recovery_leases
 SET fencing_token=fencing_token+1,lease_owner='worker-A',
 lease_expires_at=clock_timestamp()+interval '60s'
 WHERE reservation_id=rid AND lease_owner IS NULL;
 IF (SELECT fencing_token FROM ai_platform.gpt02_dev_recovery_leases WHERE reservation_id=rid) <> 1
 THEN RAISE EXCEPTION 'TOKEN_NOT_MONOTONIC';END IF;
 UPDATE ai_platform.gpt02_dev_recovery_leases SET lease_owner=NULL,lease_expires_at=NULL
 WHERE reservation_id=rid AND fencing_token=1 AND lease_owner='worker-B';
 IF FOUND THEN RAISE EXCEPTION 'FOREIGN_LEASE_RELEASE_ACCEPTED';END IF;
 UPDATE ai_platform.gpt02_dev_recovery_leases SET lease_owner=NULL,lease_expires_at=NULL
 WHERE reservation_id=rid AND fencing_token=1 AND lease_owner='worker-A';
 INSERT INTO ai_platform.gpt02_dev_recovery_lease_releases(reservation_id,fencing_token,lease_owner)
 VALUES(rid,1,'worker-A');
 BEGIN
   UPDATE ai_platform.gpt02_dev_recovery_lease_releases SET lease_owner='worker-B'
   WHERE reservation_id=rid;
   RAISE EXCEPTION 'RECEIPT_MUTATED';
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM<>'GPT02_RELEASE_RECEIPT_IMMUTABLE' THEN RAISE;END IF;
 END;
 BEGIN
   DELETE FROM ai_platform.gpt02_dev_recovery_lease_releases WHERE reservation_id=rid;
   RAISE EXCEPTION 'RECEIPT_DELETED';
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM<>'GPT02_RELEASE_RECEIPT_IMMUTABLE' THEN RAISE;END IF;
 END;
 UPDATE ai_platform.gpt02_dev_recovery_leases
 SET fencing_token=fencing_token+1,lease_owner='worker-B',
 lease_expires_at=clock_timestamp()+interval '60s'
 WHERE reservation_id=rid AND lease_owner IS NULL;
 IF (SELECT fencing_token FROM ai_platform.gpt02_dev_recovery_leases WHERE reservation_id=rid) <> 2
 THEN RAISE EXCEPTION 'TAKEOVER_TOKEN_INVALID';END IF;
 UPDATE ai_platform.gpt02_dev_recovery_leases SET lease_owner=NULL,lease_expires_at=NULL
 WHERE reservation_id=rid AND fencing_token=1 AND lease_owner='worker-A';
 IF FOUND THEN RAISE EXCEPTION 'STALE_OWNER_ACCEPTED';END IF;
END $check$;
DO $privs$
DECLARE tbl text;role_name text;
BEGIN
 FOREACH tbl IN ARRAY ARRAY[
 'gpt02_dev_recovery_command_links','gpt02_dev_recovery_leases',
 'gpt02_dev_recovery_lease_releases'] LOOP
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=('ai_platform.'||tbl)::regclass) THEN
    RAISE EXCEPTION 'LEDGER_RLS_OFF:%',tbl;
  END IF;
  FOREACH role_name IN ARRAY ARRAY['aicore_dev_runtime','anon','authenticated'] LOOP
   IF has_table_privilege(role_name,'ai_platform.'||tbl,'SELECT') OR
      has_table_privilege(role_name,'ai_platform.'||tbl,'INSERT') OR
      has_table_privilege(role_name,'ai_platform.'||tbl,'UPDATE') OR
      has_table_privilege(role_name,'ai_platform.'||tbl,'DELETE')
   THEN RAISE EXCEPTION 'BROAD_GRANT_DRIFT:%:%',role_name,tbl;END IF;
  END LOOP;
 END LOOP;
END $privs$;
SQL
echo 'PASS: isolated guarded DEV migration twice, nonowner denied, RLS and role grants closed, identity trigger, CAS tokens, immutable release receipts'
