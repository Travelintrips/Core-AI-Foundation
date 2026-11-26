#!/usr/bin/env bash
set -euo pipefail
# Uses a disposable PostgreSQL CI service. No connection to CST DEV/PROD.
export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGDATABASE=task190_ci
query() { psql -XAtq -v ON_ERROR_STOP=1 -c "$1"; }
expected_fail() {
  if psql -XAtq -v ON_ERROR_STOP=1 -c "$1" >/dev/null 2>&1; then
    printf 'FAIL: %s\n' "$2"; exit 1
  fi
  printf 'PASS: %s\n' "$2"
}
digest_a=$(printf 'a%.0s' {1..64})
digest_b=$(printf 'b%.0s' {1..64})
base="('11111111-1111-4111-8111-111111111111','default',190,'33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','owner:google_testowner01','44444444-4444-4444-8444-444444444444','independent-authority-190-001','$digest_a','$digest_b',clock_timestamp(),clock_timestamp()+interval '90 seconds')"
columns='(receipt_id,company_id,task_id,execution_id,attempt_id,owner_subject,challenge_id,authority_ref,issuer_proof_sha256,receipt_sha256,issued_at,expires_at)'
query "INSERT INTO gpt02_task190_execution_custody.consumptions $columns VALUES $base"
[[ "$(query 'SELECT count(*) FROM gpt02_task190_execution_custody.consumptions')" == "1" ]] || exit 1
echo 'PASS: COMMITTED_ROW_PERSISTS_NEW_PSQL_SESSION'
expected_fail "INSERT INTO gpt02_task190_execution_custody.consumptions $columns VALUES $base" 'DUPLICATE_ATTEMPT_REJECTED'
expected_fail "UPDATE gpt02_task190_execution_custody.consumptions SET receipt_sha256='$digest_a'" 'IMMUTABLE_UPDATE_DENIED'
expected_fail "DELETE FROM gpt02_task190_execution_custody.consumptions" 'IMMUTABLE_DELETE_DENIED'
expired="('99999999-9999-4999-8999-999999999999','default',190,'33333333-3333-4333-8333-333333333333','99999999-9999-4999-8999-999999999998','owner:google_testowner01','99999999-9999-4999-8999-999999999997','independent-authority-190-expired','$digest_a','$digest_b',clock_timestamp()-interval '90 seconds',clock_timestamp()-interval '10 seconds')"
expected_fail "INSERT INTO gpt02_task190_execution_custody.consumptions $columns VALUES $expired" 'EXPIRED_RECEIPT_DENIED'
rollback="('88888888-8888-4888-8888-888888888888','default',190,'33333333-3333-4333-8333-333333333333','88888888-8888-4888-8888-888888888887','owner:google_testowner01','88888888-8888-4888-8888-888888888886','independent-authority-190-rollback','$digest_a','$digest_b',clock_timestamp(),clock_timestamp()+interval '90 seconds')"
query "BEGIN; INSERT INTO gpt02_task190_execution_custody.consumptions $columns VALUES $rollback; ROLLBACK;"
[[ "$(query 'SELECT count(*) FROM gpt02_task190_execution_custody.consumptions')" == "1" ]] || exit 1
echo 'PASS: TRANSACTION_ROLLBACK_LEAVES_NO_ROW'
query "CREATE ROLE task190_ci_unprivileged NOLOGIN"
[[ "$(query "SELECT has_schema_privilege('task190_ci_unprivileged','gpt02_task190_execution_custody','USAGE')")" == "f" ]] || exit 1
[[ "$(query "SELECT has_table_privilege('task190_ci_unprivileged','gpt02_task190_execution_custody.consumptions','INSERT')")" == "f" ]] || exit 1
echo 'PASS: NO_PUBLIC_OR_UNPRIVILEGED_WRITER_ACCESS'
# True concurrent commit race on distinct receipt IDs but the same attempt id.
v1="('77777777-7777-4777-8777-777777777771','default',190,'33333333-3333-4333-8333-333333333333','77777777-7777-4777-8777-777777777777','owner:google_testowner01','77777777-7777-4777-8777-777777777771','independent-authority-190-race-1','$digest_a','$digest_b',clock_timestamp(),clock_timestamp()+interval '90 seconds')"
v2="('77777777-7777-4777-8777-777777777772','default',190,'33333333-3333-4333-8333-333333333333','77777777-7777-4777-8777-777777777777','owner:google_testowner01','77777777-7777-4777-8777-777777777772','independent-authority-190-race-2','$digest_a','$digest_b',clock_timestamp(),clock_timestamp()+interval '90 seconds')"
set +e
psql -XAtq -v ON_ERROR_STOP=1 -c "BEGIN; INSERT INTO gpt02_task190_execution_custody.consumptions $columns VALUES $v1; SELECT pg_sleep(1); COMMIT;" >/tmp/task190-race-a.log 2>&1 & pid1=$!
psql -XAtq -v ON_ERROR_STOP=1 -c "INSERT INTO gpt02_task190_execution_custody.consumptions $columns VALUES $v2" >/tmp/task190-race-b.log 2>&1 & pid2=$!
wait "$pid1"; rc1=$?
wait "$pid2"; rc2=$?
set -e
[[ $(( (rc1==0) + (rc2==0) )) -eq 1 ]] || { echo "FAIL: race status $rc1/$rc2"; exit 1; }
[[ "$(query "SELECT count(*) FROM gpt02_task190_execution_custody.consumptions WHERE attempt_id='77777777-7777-4777-8777-777777777777'")" == "1" ]] || exit 1
echo 'PASS: TWO_PSQL_PROCESSES_ONE_COMMITTED_CONSUMPTION'
echo 'RESULT=8/8 PASS'
