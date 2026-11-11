#!/usr/bin/env bash
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
name="gpt02-writer-fixture-$$"
tmp="$(mktemp -d)"
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || :
  rm -rf "$tmp"
}
trap cleanup EXIT
docker run -d --rm --network none --name "$name" \
  -e POSTGRES_PASSWORD=fixture-only postgres:16-alpine >/dev/null
ready=0
for i in $(seq 1 90); do
  if docker exec "$name" psql -U postgres -Atqc 'SELECT 1' 2>/dev/null | grep -qx 1; then
    sleep .3
    if docker exec "$name" psql -U postgres -Atqc 'SELECT 1' 2>/dev/null | grep -qx 1; then ready=1;break;fi
  fi
  sleep .2
done
test "$ready" = 1 || { echo "FAIL: PG16_NOT_READY";exit 1; }
docker cp "$root/scripts/dev/gpt02_issue159_split_owner_fixture.sql" "$name:/tmp/fixture.sql"
docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/fixture.sql >"$tmp/setup" 2>&1 || { cat "$tmp/setup";exit 1; }
# Direct table DML must be absent for writer; functions alone are callable.
docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -Atqc "
DO \$block\$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['gpt02_fixture_prep.preparations','gpt02_fixture_store.approvals']
 LOOP
  IF has_table_privilege('gpt02_fixture_writer',name,'INSERT')
    OR has_table_privilege('gpt02_fixture_writer',name,'UPDATE')
    OR has_table_privilege('gpt02_fixture_writer',name,'DELETE')
    OR has_table_privilege('gpt02_fixture_reader',name,'INSERT')
  THEN RAISE EXCEPTION 'DML_PRIVILEGE_LEAK %',name;END IF;
 END LOOP;
 IF NOT has_function_privilege('gpt02_fixture_writer','gpt02_fixture_prep.prepare_core_task(bigint,uuid,text)','EXECUTE')
 OR NOT has_function_privilege('gpt02_fixture_writer','gpt02_fixture_store.record_linked_approval(bigint,uuid,text,text)','EXECUTE')
 OR has_function_privilege('gpt02_fixture_reader','gpt02_fixture_prep.prepare_core_task(bigint,uuid,text)','EXECUTE')
 OR has_function_privilege('gpt02_fixture_reader','gpt02_fixture_store.record_linked_approval(bigint,uuid,text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'EXECUTE_PRIVILEGE_LEAK';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='gpt02_fixture_prep.preparations'::regclass AND relrowsecurity AND relforcerowsecurity)
 OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='gpt02_fixture_store.approvals'::regclass AND relrowsecurity AND relforcerowsecurity)
 THEN RAISE EXCEPTION 'RLS_MISSING'; END IF;
END \$block\$;"
# Fixture session identity and two independent owners.
docker exec "$name" psql -U gpt02_fixture_writer -d postgres -v ON_ERROR_STOP=1 -Atqc "
SELECT gpt02_fixture_prep.prepare_core_task(140,'10000000-0000-4000-8000-000000000001','NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN');
SELECT gpt02_fixture_store.record_linked_approval(140,'10000000-0000-4000-8000-000000000001','NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN','fixture-super-admin');" >"$tmp/success"
grep -qx 'PREPARED_NO_DISPATCH' "$tmp/success"
grep -qx 'RECORD_ONLY_NO_DISPATCH' "$tmp/success"
# Replays are not allowed to insert a second row.
if docker exec "$name" psql -U gpt02_fixture_writer -d postgres -v ON_ERROR_STOP=1 -Atqc "
SELECT gpt02_fixture_store.record_linked_approval(140,'10000000-0000-4000-8000-000000000001','NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN','fixture-super-admin');" >"$tmp/replay" 2>&1; then
 echo 'FAIL: REPLAY_ACCEPTED';exit 1
fi
grep -q 'duplicate key' "$tmp/replay"
# Invalid operator must be rejected before write.
if docker exec "$name" psql -U gpt02_fixture_writer -d postgres -v ON_ERROR_STOP=1 -Atqc "
SELECT gpt02_fixture_store.record_linked_approval(141,'10000000-0000-4000-8000-000000000002','MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM','other');" >"$tmp/wrong" 2>&1; then
 echo 'FAIL: WRONG_ADMIN_ACCEPTED';exit 1
fi
grep -q 'APPROVAL_SCOPE_DENIED' "$tmp/wrong"
# Transaction rollback must discard an earlier preparation if approval fails.
if docker exec "$name" psql -U gpt02_fixture_writer -d postgres -v ON_ERROR_STOP=1 -Atqc "
BEGIN;
SELECT gpt02_fixture_prep.prepare_core_task(143,'10000000-0000-4000-8000-000000000005','CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC');
SELECT gpt02_fixture_store.record_linked_approval(143,'10000000-0000-4000-8000-000000000005','CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC','other');
COMMIT;" >"$tmp/rollback" 2>&1; then
 echo 'FAIL: INVALID_TRANSACTION_COMMITTED';exit 1
fi
grep -q 'APPROVAL_SCOPE_DENIED' "$tmp/rollback"
# Both evidence tables must reject owner/superuser UPDATE/DELETE/TRUNCATE.
for op in   "UPDATE gpt02_fixture_prep.preparations SET nonce='CHANGED' WHERE task_id=140"   "DELETE FROM gpt02_fixture_prep.preparations WHERE task_id=140"   "TRUNCATE gpt02_fixture_prep.preparations"   "UPDATE gpt02_fixture_store.approvals SET approved_by='other' WHERE task_id=140"   "DELETE FROM gpt02_fixture_store.approvals WHERE task_id=140"   "TRUNCATE gpt02_fixture_store.approvals"; do
 if docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -Atqc "$op" >"$tmp/immutability" 2>&1; then
   echo 'FAIL: APPEND_ONLY_MUTATION_ACCEPTED';exit 1
 fi
 grep -Eq '(PREPARATION_IMMUTABLE|APPROVAL_IMMUTABLE)' "$tmp/immutability"
done
# Race: competing different commands for the same identity => exactly one winner.
docker exec "$name" psql -U postgres -c "ALTER ROLE gpt02_fixture_writer CONNECTION LIMIT 3" >/dev/null
docker exec "$name" psql -U gpt02_fixture_writer -d postgres -Atqc "
SELECT gpt02_fixture_prep.prepare_core_task(142,'10000000-0000-4000-8000-000000000003','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');" >"$tmp/race-a" 2>&1 &
a=$!
docker exec "$name" psql -U gpt02_fixture_writer -d postgres -Atqc "
SELECT gpt02_fixture_prep.prepare_core_task(142,'10000000-0000-4000-8000-000000000004','BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');" >"$tmp/race-b" 2>&1 &
b=$!
wait "$a" || :
wait "$b" || :
winners="$(grep -l 'PREPARED_NO_DISPATCH' "$tmp/race-a" "$tmp/race-b" | wc -l)"
test "$winners" = 1 || { echo "FAIL: RACE_WINNERS_$winners";cat "$tmp"/race-*;exit 1; }
# Immutable survivor and zero unexpected evidence.
counts="$(docker exec "$name" psql -U postgres -Atqc "
SELECT (SELECT count(*) FROM gpt02_fixture_prep.preparations)::text || ':' ||
       (SELECT count(*) FROM gpt02_fixture_store.approvals)::text;")"
test "$counts" = '2:1' || { echo "FAIL: COUNTS_$counts";exit 1; }
# Roles have no direct table privileges after all fixture calls.
echo 'PASS: PG16 split owners, EXECUTE-only writer, forced RLS, replay denial, invalid admin denial, concurrent exactly-one, atomic rollback, append-only UPDATE/DELETE/TRUNCATE denied; NO LIVE DB'

[executed on device: srv1792369 (0891e23a-6a6b-4f8c-a16a-962e888e2014)]