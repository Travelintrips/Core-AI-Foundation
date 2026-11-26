#!/usr/bin/env bash
set -euo pipefail
export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGDATABASE=task190_ci
q(){ psql -XAtq -v ON_ERROR_STOP=1 -c "$1"; }
deny(){ if psql -XAtq -v ON_ERROR_STOP=1 -c "$1" >/dev/null 2>&1;then echo "FAIL:$2";exit 1;fi; echo "PASS:$2"; }
a=$(printf 'a%.0s' {1..64})
cols="(claim_id,company_id,task_id,execution_id,attempt_id,owner_subject,challenge_id,authority_ref,issuer_proof_sha256,expires_at)"
v1="('11111111-1111-4111-8111-111111111111','default',190,'33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','owner:google_testowner01','44444444-4444-4444-8444-444444444444','independent-issuer-claim-ref-01','$a',clock_timestamp()+interval '90 seconds')"
q "INSERT INTO gpt02_task190_execution_custody.claims $cols VALUES $v1"
[[ "$(q 'SELECT count(*) FROM gpt02_task190_execution_custody.claims')" == '1' ]] || exit 1
echo 'PASS:CLAIM_PERSISTS_NEW_DB_SESSION'
deny "INSERT INTO gpt02_task190_execution_custody.claims $cols VALUES $v1" 'DUPLICATE_CLAIM_DENIED'
deny "UPDATE gpt02_task190_execution_custody.claims SET owner_subject='owner:google_testowner02'" 'CLAIM_IMMUTABLE_UPDATE'
deny "DELETE FROM gpt02_task190_execution_custody.claims" 'CLAIM_IMMUTABLE_DELETE'
expired="('99999999-9999-4999-8999-999999999999','default',190,'33333333-3333-4333-8333-333333333333','99999999-9999-4999-8999-999999999998','owner:google_testowner01','99999999-9999-4999-8999-999999999997','independent-issuer-expired-01','$a',clock_timestamp()-interval '10 seconds')"
deny "INSERT INTO gpt02_task190_execution_custody.claims $cols VALUES $expired" 'EXPIRED_AUTHORITY_DENIED'
future="('99999999-9999-4999-8999-999999999999','default',190,'33333333-3333-4333-8333-333333333333','99999999-9999-4999-8999-999999999998','owner:google_testowner01','99999999-9999-4999-8999-999999999997','independent-issuer-future-001','$a',clock_timestamp()+interval '180 seconds')"
deny "INSERT INTO gpt02_task190_execution_custody.claims $cols VALUES $future" 'OVERSCOPED_AUTHORITY_DENIED'
q "CREATE ROLE task190_claim_ci_unprivileged NOLOGIN"
[[ "$(q "SELECT has_table_privilege('task190_claim_ci_unprivileged','gpt02_task190_execution_custody.claims','INSERT')")" == 'f' ]] || exit 1
[[ "$(q "SELECT has_schema_privilege('task190_claim_ci_unprivileged','gpt02_task190_execution_custody','USAGE')")" == 'f' ]] || exit 1
echo 'PASS:APP_ROLE_ZERO_GRANTS'
race1="('77777777-7777-4777-8777-777777777771','default',190,'33333333-3333-4333-8333-333333333333','77777777-7777-4777-8777-777777777777','owner:google_testowner01','77777777-7777-4777-8777-777777777771','independent-issuer-claim-race-a','$a',clock_timestamp()+interval '90 seconds')"
race2="('77777777-7777-4777-8777-777777777772','default',190,'33333333-3333-4333-8333-333333333333','77777777-7777-4777-8777-777777777777','owner:google_testowner01','77777777-7777-4777-8777-777777777772','independent-issuer-claim-race-b','$a',clock_timestamp()+interval '90 seconds')"
set +e
psql -XAtq -v ON_ERROR_STOP=1 -c "BEGIN; INSERT INTO gpt02_task190_execution_custody.claims $cols VALUES $race1; SELECT pg_sleep(0.5); COMMIT;" >/tmp/task190-claim-race-a.log 2>&1 & p1=$!
psql -XAtq -v ON_ERROR_STOP=1 -c "INSERT INTO gpt02_task190_execution_custody.claims $cols VALUES $race2" >/tmp/task190-claim-race-b.log 2>&1 & p2=$!
wait "$p1"; r1=$?
wait "$p2"; r2=$?
set -e
[[ $(( (r1==0) + (r2==0) )) -eq 1 ]] || { echo "FAIL:RACE";exit 1; }
[[ "$(q "SELECT count(*) FROM gpt02_task190_execution_custody.claims WHERE attempt_id='77777777-7777-4777-8777-777777777777'")" == '1' ]] || exit 1
echo 'PASS:TWO_PROCESSES_ONE_CLAIM'
[[ "$(q 'SELECT count(*) FROM gpt02_task190_execution_custody.consumptions')" == '0' ]] || exit 1
echo 'PASS:NO_EXECUTION_CONSUMPTION_OR_DISPATCH'
echo 'RESULT=9/9 PASS'
