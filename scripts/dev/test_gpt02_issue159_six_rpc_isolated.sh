#!/usr/bin/env bash
# Synthetic six-stage lifecycle, disposable PostgreSQL 16, no-network.
set -Eeuo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
name="gpt02-sixrpc-$$"
tmp="$(mktemp -d)"
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || :; rm -rf "$tmp"; }
trap cleanup EXIT
docker run -d --rm --network none --name "$name" -e POSTGRES_PASSWORD=fixture-only postgres:16-alpine >/dev/null
ready=0
for i in $(seq 1 100); do
 if docker exec "$name" psql -U postgres -Atqc 'SELECT 1' 2>/dev/null | grep -qx 1; then
  sleep .2
  if docker exec "$name" psql -U postgres -Atqc 'SELECT 1' 2>/dev/null | grep -qx 1; then ready=1;break;fi
 fi
 sleep .2
done
test "$ready" = 1 || { echo 'PG16_NOT_READY';exit 1; }
docker cp "$root/scripts/dev/gpt02_issue159_split_owner_fixture.sql" "$name:/tmp/base.sql"
docker cp "$root/scripts/dev/gpt02_issue159_six_rpc_fixture_addon.sql" "$name:/tmp/addon.sql"
docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/base.sql >"$tmp/setup" 2>&1 || { cat "$tmp/setup";exit 1; }
docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/addon.sql >"$tmp/addon" 2>&1 || { cat "$tmp/addon";exit 1; }
call(){ docker exec "$name" psql -U gpt02_fixture_writer -d postgres -v ON_ERROR_STOP=1 -Atqc "$1"; }
CMD=10000000-0000-4000-8000-000000000001
NONCE=NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN
DIGEST=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
WORKER=openclaw-dell-chatgpt-wake-dev
call "SELECT gpt02_fixture_prep.prepare_core_task(140,'$CMD','$NONCE')" | grep -qx PREPARED_NO_DISPATCH
call "SELECT gpt02_fixture_store.record_linked_approval(140,'$CMD','$NONCE','fixture-super-admin')" | grep -qx RECORD_ONLY_NO_DISPATCH
if call "SELECT gpt02_fixture_store.reserve_post_consumption_fence(140,'$CMD','$NONCE','$WORKER')" >"$tmp/early" 2>&1; then
 echo 'FENCE_WITHOUT_NONCE';exit 1
fi
grep -q FRESH_CONSUMED_NONCE_REQUIRED "$tmp/early"
receipt="$(call "SELECT gpt02_fixture_store.consume_linked_approval(140,'$CMD','$NONCE','$DIGEST')")"
[[ "$receipt" =~ ^[0-9a-f-]{36}$ ]] || exit 1
if call "SELECT gpt02_fixture_store.consume_linked_approval(140,'$CMD','$NONCE','$DIGEST')" >"$tmp/replay-nonce" 2>&1; then
 echo 'NONCE_REPLAY_ACCEPTED';exit 1
fi
grep -q 'duplicate key' "$tmp/replay-nonce"
if call "SELECT gpt02_fixture_store.reserve_post_consumption_fence(140,'$CMD','$NONCE','other-worker')" >"$tmp/worker" 2>&1; then
 echo 'WRONG_WORKER_ACCEPTED';exit 1
fi
grep -q FENCE_SCOPE_DENIED "$tmp/worker"
fence="$(call "SELECT gpt02_fixture_store.reserve_post_consumption_fence(140,'$CMD','$NONCE','$WORKER')")"
[[ "$fence" =~ ^[0-9a-f-]{36}$ ]] || exit 1
if call "SELECT gpt02_fixture_store.record_issuer_evidence(140,'$CMD','ffffffff-ffff-4fff-8fff-ffffffffffff','$DIGEST')" >"$tmp/wrongfence" 2>&1; then
 echo 'WRONG_FENCE_ACCEPTED';exit 1
fi
grep -q ACTIVE_FENCE_REQUIRED "$tmp/wrongfence"
evidence="$(call "SELECT gpt02_fixture_store.record_issuer_evidence(140,'$CMD','$fence','$DIGEST')")"
[[ "$evidence" =~ ^[0-9a-f-]{36}$ ]] || exit 1
call "SELECT gpt02_fixture_store.consume_issuer_lease(140,'$CMD','$evidence')" | grep -qx LEASE_CONSUMED_NO_DISPATCH
if call "SELECT gpt02_fixture_store.consume_issuer_lease(140,'$CMD','$evidence')" >"$tmp/replay-lease" 2>&1; then
 echo 'LEASE_REPLAY_ACCEPTED';exit 1
fi
grep -q 'duplicate key' "$tmp/replay-lease"
docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -Atqc "
DO \$proof\$
DECLARE tbl text; fn text;
BEGIN
 FOREACH tbl IN ARRAY ARRAY['nonce_receipts','fences','issuer_evidence','lease_consumptions'] LOOP
  IF has_table_privilege('gpt02_fixture_writer','gpt02_fixture_store.'||tbl,'INSERT')
    OR has_table_privilege('gpt02_fixture_writer','gpt02_fixture_store.'||tbl,'UPDATE')
    OR has_table_privilege('gpt02_fixture_reader','gpt02_fixture_store.'||tbl,'SELECT')
  THEN RAISE EXCEPTION 'TABLE_PRIVILEGE_LEAK %',tbl; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=('gpt02_fixture_store.'||tbl)::regclass
    AND relrowsecurity AND relforcerowsecurity)
  THEN RAISE EXCEPTION 'FORCED_RLS_MISSING %',tbl; END IF;
 END LOOP;
 FOREACH fn IN ARRAY ARRAY[
  'consume_linked_approval(bigint,uuid,text,text)',
  'reserve_post_consumption_fence(bigint,uuid,text,text)',
  'record_issuer_evidence(bigint,uuid,uuid,text)',
  'consume_issuer_lease(bigint,uuid,uuid)'
 ] LOOP
  IF NOT has_function_privilege('gpt02_fixture_writer','gpt02_fixture_store.'||fn,'EXECUTE')
    OR has_function_privilege('gpt02_fixture_reader','gpt02_fixture_store.'||fn,'EXECUTE')
  THEN RAISE EXCEPTION 'RPC_EXECUTE_LEAK %',fn;END IF;
 END LOOP;
 IF (SELECT count(*) FROM gpt02_fixture_store.nonce_receipts)<>1
  OR (SELECT count(*) FROM gpt02_fixture_store.fences)<>1
  OR (SELECT count(*) FROM gpt02_fixture_store.issuer_evidence)<>1
  OR (SELECT count(*) FROM gpt02_fixture_store.lease_consumptions)<>1
  OR (SELECT bool_and(NOT dispatch_allowed) FROM gpt02_fixture_store.fences) IS DISTINCT FROM true
  OR (SELECT bool_and(NOT dispatch_allowed) FROM gpt02_fixture_store.lease_consumptions) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'ROW_COUNTS_OR_DISPATCH_VIOLATION';END IF;
END \$proof\$;" >"$tmp/verification" 2>&1 || { cat "$tmp/verification";exit 1; }
for tbl in nonce_receipts fences issuer_evidence lease_consumptions; do
 for op in "DELETE FROM gpt02_fixture_store.$tbl" "TRUNCATE gpt02_fixture_store.$tbl"; do
  if docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -Atqc "$op" >"$tmp/immutable" 2>&1; then
   echo "APPEND_ONLY_BYPASS_$tbl";exit 1
  fi
  grep -Eq "APPROVAL_IMMUTABLE|cannot truncate a table referenced in a foreign key constraint" "$tmp/immutable"
 done
done
echo 'PASS: disposable six-RPC ordered evidence, nonce/lease one-shot, wrong worker/fence rejected, forced RLS, EXECUTE-only and NO_DISPATCH'

[executed on device: srv1792369 (0891e23a-6a6b-4f8c-a16a-962e888e2014)]