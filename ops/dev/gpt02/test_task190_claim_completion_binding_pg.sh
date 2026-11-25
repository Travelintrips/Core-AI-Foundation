#!/usr/bin/env bash
set -euo pipefail
export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGDATABASE=task190_ci
sql(){ psql -XAtq -v ON_ERROR_STOP=1 -c "$1"; }
deny(){ if psql -XAtq -v ON_ERROR_STOP=1 -c "$1" >/dev/null 2>&1; then echo "FAIL:$2";exit 1;fi;echo "PASS:$2"; }
a=$(printf 'a%.0s' {1..64})
b=$(printf 'b%.0s' {1..64})
cc="(receipt_id,company_id,task_id,execution_id,attempt_id,owner_subject,challenge_id,authority_ref,issuer_proof_sha256,receipt_sha256,issued_at,expires_at)"
claimcols="(claim_id,company_id,task_id,execution_id,attempt_id,owner_subject,challenge_id,authority_ref,issuer_proof_sha256,expires_at)"
values="'default',190,'33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','owner:google_testowner01','44444444-4444-4444-8444-444444444444','independent-authority-190-001','$a'"
receipt="('55555555-5555-4555-8555-555555555555',${values},'$b',clock_timestamp(),clock_timestamp()+interval '90 seconds')"
claim="('66666666-6666-4666-8666-666666666666',${values},clock_timestamp()+interval '90 seconds')"
deny "INSERT INTO gpt02_task190_execution_custody.consumptions $cc VALUES $receipt" 'CONSUMPTION_WITHOUT_CLAIM_DENIED'
sql "INSERT INTO gpt02_task190_execution_custody.claims $claimcols VALUES $claim"
echo 'PASS:IMMUTABLE_CLAIM_INSERTED'
wrongowner="('55555555-5555-4555-8555-555555555555','default',190,'33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','owner:google_wrongowner01','44444444-4444-4444-8444-444444444444','independent-authority-190-001','$a','$b',clock_timestamp(),clock_timestamp()+interval '90 seconds')"
deny "INSERT INTO gpt02_task190_execution_custody.consumptions $cc VALUES $wrongowner" 'WRONG_OWNER_BINDING_DENIED'
wrongproof="('55555555-5555-4555-8555-555555555555','default',190,'33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','owner:google_testowner01','44444444-4444-4444-8444-444444444444','independent-authority-190-001','$b','$b',clock_timestamp(),clock_timestamp()+interval '90 seconds')"
deny "INSERT INTO gpt02_task190_execution_custody.consumptions $cc VALUES $wrongproof" 'WRONG_ISSUER_PROOF_DENIED'
wrongchallenge="('55555555-5555-4555-8555-555555555555','default',190,'33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','owner:google_testowner01','99999999-9999-4999-8999-999999999999','independent-authority-190-001','$a','$b',clock_timestamp(),clock_timestamp()+interval '90 seconds')"
deny "INSERT INTO gpt02_task190_execution_custody.consumptions $cc VALUES $wrongchallenge" 'WRONG_CHALLENGE_DENIED'
sql "INSERT INTO gpt02_task190_execution_custody.consumptions $cc VALUES $receipt"
[[ "$(sql 'SELECT count(*) FROM gpt02_task190_execution_custody.consumptions')" == '1' ]] || exit 1
echo 'PASS:EXACT_CLAIM_ALLOWS_ONE_COMPLETION'
deny "INSERT INTO gpt02_task190_execution_custody.consumptions $cc VALUES $receipt" 'DUPLICATE_COMPLETION_DENIED'
deny "DELETE FROM gpt02_task190_execution_custody.claims" 'CLAIM_IMMUTABLE_WITH_COMPLETION'
[[ "$(sql "SELECT count(*) FROM pg_constraint WHERE conname='task190_consumption_requires_exact_claim' AND contype='f' AND condeferrable=false")" == '1' ]] || exit 1
echo 'PASS:FOREIGN_KEY_NON_DEFERRABLE'
[[ "$(sql "SELECT has_table_privilege('anon','gpt02_task190_execution_custody.consumptions','INSERT')")" == 'f' ]] || exit 1
[[ "$(sql "SELECT has_table_privilege('authenticated','gpt02_task190_execution_custody.consumptions','INSERT')")" == 'f' ]] || exit 1
echo 'PASS:PUBLIC_WRITE_NOT_GRANTED'
echo 'RESULT=10/10 PASS'
