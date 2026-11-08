#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
NAME="gpt02-nonce-test-$$"
TMPDIR_TEST=$(mktemp -d)
cleanup(){ docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$TMPDIR_TEST"; }
trap cleanup EXIT
docker run --rm -d --name "$NAME" -e POSTGRES_PASSWORD=test-only -e POSTGRES_DB=isolated postgres:16-alpine >/dev/null
ready=0
for _ in $(seq 1 45); do
 if docker exec "$NAME" psql -X -h 127.0.0.1 -U postgres -d isolated -v ON_ERROR_STOP=1 -Atqc 'SELECT 1' 2>/dev/null | grep -qx 1; then ready=1; break; fi
 sleep 1
done
[[ "$ready" == 1 ]] || { echo 'ISOLATED_NONCE_POSTGRES_UNAVAILABLE'; exit 2; }
for sql in "$ROOT/docs/dev/gpt02-task-attempt-binding.proposed.sql" "$ROOT/docs/dev/gpt02-binding-attestation-nonces.proposed.sql"; do
 docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d isolated < "$sql" >/dev/null
done
# Verify complete catalog invariants before using synthetic data.
NONCE_GUARD="$ROOT/scripts/dev/gpt02-binding-nonce-schema-drift-guard.sql"
docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d isolated < "$NONCE_GUARD" >/dev/null
assert_nonce_drift_denied(){
 local label="$1" patch="$2" logfile="$TMPDIR_TEST/drift-$1.log"
 # Changes are intentionally rolled back when the guard raises.
 if {
   printf 'BEGIN;\\n%s\\n' "$patch"
   printf "SELECT 'GPT02_NONCE_PATCH_APPLIED' AS marker;\\n"
   cat "$NONCE_GUARD"
 } | docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d isolated >"$logfile" 2>&1; then
   echo "NONCE_DRIFT_NOT_DETECTED:$label" >&2; exit 2
 fi
 if ! grep -q GPT02_NONCE_PATCH_APPLIED "$logfile" || ! grep -Eq 'ERROR:.*GPT02_NONCE_.*DRIFT' "$logfile"; then
   cat "$logfile" >&2; echo "NONCE_DRIFT_TEST_INVALID:$label" >&2; exit 2
 fi
 echo "NONCE_${label}_DRIFT_DENIED_PASS"
}
assert_nonce_drift_denied UNIQUE 'ALTER TABLE ai_platform.dev_gpt02_binding_attestation_nonces DROP CONSTRAINT dev_gpt02_nonce_attempt_once;'
assert_nonce_drift_denied FK 'ALTER TABLE ai_platform.dev_gpt02_binding_attestation_nonces DROP CONSTRAINT dev_gpt02_nonce_binding_provenance_fk;'
assert_nonce_drift_denied TRIGGER 'ALTER TABLE ai_platform.dev_gpt02_binding_attestation_nonces DISABLE TRIGGER dev_gpt02_nonce_immutable_trg;'
assert_nonce_drift_denied GRANT 'GRANT INSERT ON ai_platform.dev_gpt02_binding_attestation_nonces TO PUBLIC;'
assert_nonce_drift_denied DENIAL 'ALTER TABLE ai_platform.dev_gpt02_binding_attestation_nonces DROP CONSTRAINT dev_gpt02_binding_attestation_nonces_may_issue_grant_check;'
# All rejected mutations must have rolled back.
docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d isolated < "$NONCE_GUARD" >/dev/null
cat > "$TMPDIR_TEST/race.sql" <<'SQL'
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO ai_platform.dev_gpt02_binding_attestation_nonces
(nonce,tenant_id,core_command_id,hub_execution_job_id,attempt_id,operator_user_id,evidence_sha256,attestation_sha256,issued_at,expires_at)
VALUES ('caa69098-41f2-4cf2-8114-af7a3b357fc3','default',
 'a7eb36f0-404b-480d-a42b-17b4250f3149',
 '37167f35-53a6-48b2-bec9-ac5ac352748d',
 'e942fc15-42c2-4cf3-9359-24369731ae8e',301,repeat('a',64),repeat('b',64),now(),now()+interval '90 seconds');
INSERT INTO ai_platform.dev_gpt02_task_attempt_binding_claims
(tenant_id,core_command_id,core_coding_task_id,hub_execution_job_id,hub_ai_task_id,
 attempt_id,attempt_number,worker_id,assignee_namespace,assignee_id,owner_namespace,
 accountable_owner_id,evidence_sha256,evidence_source,operator_user_id,recorded_by,source_observed_at,receiver_observed_at)
VALUES ('default','a7eb36f0-404b-480d-a42b-17b4250f3149',
 '965604aa-9e6b-478b-8e33-cc52a8f0b8ca',
 '37167f35-53a6-48b2-bec9-ac5ac352748d',42,
 'e942fc15-42c2-4cf3-9359-24369731ae8e',1,'openclaw-dell-chatgpt-wake-dev',
 'ai_task_hub.public.ai_tasks.assigned_to_id',7,'ai_task_hub.accountable_owner',
 'synthetic-owner',repeat('a',64),'independent_dev_attestation',301,'internal:301',now(),now());
SELECT pg_sleep(2);
COMMIT;
SQL
docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d isolated < "$TMPDIR_TEST/race.sql" > "$TMPDIR_TEST/first.log" 2>&1 & A=$!
sleep 0.3
docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d isolated < "$TMPDIR_TEST/race.sql" > "$TMPDIR_TEST/second.log" 2>&1 & B=$!
set +e
wait "$A"; E1=$?
wait "$B"; E2=$?
set -e
[[ "$E1" -eq 0 && "$E2" -ne 0 ]] || { echo 'NONCE_RACE_UNEXPECTED_WINNERS'; tail -15 "$TMPDIR_TEST/first.log" "$TMPDIR_TEST/second.log"; exit 2; }
grep -Eq 'duplicate key value violates unique constraint "dev_gpt02_binding_attestation_nonces_pkey"' "$TMPDIR_TEST/second.log" || { echo 'NONCE_RACE_WRONG_FAILURE'; exit 2; }
N=$(docker exec "$NAME" psql -X -At -U postgres -d isolated -c "SELECT (SELECT count(*) FROM ai_platform.dev_gpt02_binding_attestation_nonces),(SELECT count(*) FROM ai_platform.dev_gpt02_task_attempt_binding_claims)")
[[ "$N" == '1|1' ]] || { echo "NON_ATOMIC_ROWS:$N"; exit 2; }
echo 'ATOMIC_NONCE_AND_BINDING_SINGLE_WINNER_PASS'
# Invalid claim in same transaction MUST roll back previously reserved nonce.
cat > "$TMPDIR_TEST/rollback.sql" <<'SQL'
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO ai_platform.dev_gpt02_binding_attestation_nonces
(nonce,tenant_id,core_command_id,hub_execution_job_id,attempt_id,operator_user_id,evidence_sha256,attestation_sha256,issued_at,expires_at)
VALUES ('d93fc770-fb26-4f0b-a124-922243dba215','default',gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),301,repeat('c',64),repeat('d',64),now(),now()+interval '90 seconds');
INSERT INTO ai_platform.dev_gpt02_task_attempt_binding_claims
(tenant_id,core_command_id,core_coding_task_id,hub_execution_job_id,hub_ai_task_id,
 attempt_id,attempt_number,worker_id,assignee_namespace,assignee_id,owner_namespace,
 accountable_owner_id,evidence_sha256,evidence_source,operator_user_id,recorded_by,source_observed_at,receiver_observed_at)
VALUES ('default',gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),48,gen_random_uuid(),1,
 'openclaw-dell-chatgpt-wake-dev','ai_task_hub.public.ai_tasks.assigned_to_id',7,
 'ai_task_hub.accountable_owner','',repeat('e',64),'independent_dev_attestation',301,'internal:301',now(),now());
COMMIT;
SQL
if docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d isolated < "$TMPDIR_TEST/rollback.sql" > "$TMPDIR_TEST/rollback.log" 2>&1; then echo 'INVALID_BINDING_INSERT_ACCEPTED'; exit 2; fi
grep -q 'violates check constraint' "$TMPDIR_TEST/rollback.log" || { echo 'WRONG_ROLLBACK_REASON'; exit 2; }
N=$(docker exec "$NAME" psql -X -At -U postgres -d isolated -c "SELECT count(*) FROM ai_platform.dev_gpt02_binding_attestation_nonces WHERE nonce='d93fc770-fb26-4f0b-a124-922243dba215'")
[[ "$N" == 0 ]] || { echo 'NONCE_NOT_ROLLED_BACK'; exit 2; }
echo 'FAILED_BINDING_ROLLS_BACK_NONCE_PASS'
cat > "$TMPDIR_TEST/immutability.sql" <<'SQL'
\set ON_ERROR_STOP on
UPDATE ai_platform.dev_gpt02_binding_attestation_nonces SET may_dispatch_worker=true;
SQL
if docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d isolated < "$TMPDIR_TEST/immutability.sql" > "$TMPDIR_TEST/immutable.log" 2>&1; then echo 'NONCE_MUTATION_ACCEPTED'; exit 2; fi
grep -q 'GPT02_NONCE_IMMUTABLE' "$TMPDIR_TEST/immutable.log" || { echo 'NONCE_IMMUTABILITY_ERROR_MISMATCH'; exit 2; }
echo 'NONCE_IMMUTABILITY_PASS'
# Read-back is relational, not an assertion from the request body.
READBACK=$(docker exec "$NAME" psql -X -At -v ON_ERROR_STOP=1 -U postgres -d isolated -c "SELECT count(*) FROM ai_platform.dev_gpt02_binding_attestation_nonces n JOIN ai_platform.dev_gpt02_task_attempt_binding_claims b ON b.core_command_id=n.core_command_id AND b.hub_execution_job_id=n.hub_execution_job_id AND b.attempt_id=n.attempt_id AND b.evidence_sha256=n.evidence_sha256 AND n.operator_user_id=b.operator_user_id WHERE n.tenant_id=b.tenant_id AND b.recorded_by='internal:'||n.operator_user_id::text AND b.binding_verified=false AND b.may_dispatch_worker=false AND b.may_close_job=false AND n.may_issue_grant=false AND n.may_dispatch_worker=false")
[[ "$READBACK" == 1 ]] || { echo "BOUND_READBACK_FAILED:$READBACK"; exit 2; }
echo 'POST_COMMIT_INDEPENDENT_RELATIONAL_READBACK_PASS'
# A nonce-only transaction must fail at COMMIT (DEFERRABLE foreign key).
cat > "$TMPDIR_TEST/orphan.sql" <<'SQL'
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO ai_platform.dev_gpt02_binding_attestation_nonces
(nonce,tenant_id,core_command_id,hub_execution_job_id,attempt_id,operator_user_id,evidence_sha256,attestation_sha256,issued_at,expires_at)
VALUES (gen_random_uuid(),'default',gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),301,
repeat('d',64),repeat('e',64),now(),now()+interval '60 seconds');
COMMIT;
SQL
if docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d isolated < "$TMPDIR_TEST/orphan.sql" > "$TMPDIR_TEST/orphan.log" 2>&1; then echo 'ORPHAN_NONCE_COMMITTED'; exit 2; fi
grep -q 'violates foreign key constraint "dev_gpt02_nonce_binding_provenance_fk"' "$TMPDIR_TEST/orphan.log" || { echo 'ORPHAN_WRONG_ERROR'; tail -10 "$TMPDIR_TEST/orphan.log"; exit 2; }
echo 'ORPHAN_NONCE_COMMIT_DENIED_PASS'
# A real binding with same command/receiver/attempt but different evidence must
# not satisfy the FK. Run in a rollback-only transaction with fresh identity.
cat > "$TMPDIR_TEST/mismatch.sql" <<'SQL'
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO ai_platform.dev_gpt02_task_attempt_binding_claims
(tenant_id,core_command_id,core_coding_task_id,hub_execution_job_id,hub_ai_task_id,
 attempt_id,attempt_number,worker_id,assignee_namespace,assignee_id,owner_namespace,
 accountable_owner_id,evidence_sha256,evidence_source,operator_user_id,recorded_by,source_observed_at,receiver_observed_at)
VALUES ('default','5688248a-4d6c-4ea1-a8fb-0b42a9c67140',gen_random_uuid(),
 'b4601db8-e92f-4ab2-a9ad-b676966e7e40',49,
 '3d4600d7-840e-43c0-a48c-93807d351546',1,'openclaw-dell-chatgpt-wake-dev',
 'ai_task_hub.public.ai_tasks.assigned_to_id',8,'ai_task_hub.accountable_owner',
 'synthetic-owner-2',repeat('c',64),'independent_dev_attestation',301,'internal:301',now(),now());
INSERT INTO ai_platform.dev_gpt02_binding_attestation_nonces
(nonce,tenant_id,core_command_id,hub_execution_job_id,attempt_id,operator_user_id,evidence_sha256,attestation_sha256,issued_at,expires_at)
VALUES (gen_random_uuid(),'default','5688248a-4d6c-4ea1-a8fb-0b42a9c67140',
 'b4601db8-e92f-4ab2-a9ad-b676966e7e40',
 '3d4600d7-840e-43c0-a48c-93807d351546',301,
 repeat('f',64),repeat('e',64),now(),now()+interval '60 seconds');
COMMIT;
SQL
if docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d isolated < "$TMPDIR_TEST/mismatch.sql" > "$TMPDIR_TEST/mismatch.log" 2>&1; then echo 'MISMATCHED_EVIDENCE_COMMITTED'; exit 2; fi
grep -q 'violates foreign key constraint "dev_gpt02_nonce_binding_provenance_fk"' "$TMPDIR_TEST/mismatch.log" || { echo 'MISMATCHED_EVIDENCE_WRONG_ERROR'; tail -10 "$TMPDIR_TEST/mismatch.log"; exit 2; }
echo 'MISMATCHED_NONCE_PROVENANCE_DENIED_PASS'
# The rejected transaction must not leave the second claim behind.
N=$(docker exec "$NAME" psql -X -At -v ON_ERROR_STOP=1 -U postgres -d isolated -c "SELECT (SELECT count(*) FROM ai_platform.dev_gpt02_task_attempt_binding_claims),(SELECT count(*) FROM ai_platform.dev_gpt02_binding_attestation_nonces)")
[[ "$N" == '1|1' ]] || { echo "REJECTED_TRANSACTION_LEFT_ROWS:$N"; exit 2; }
echo 'REJECTED_PROVENANCE_TRANSACTION_ATOMIC_ROLLBACK_PASS'
# A same-command/same-receiver/same-evidence nonce cannot claim another operator.
cat > "$TMPDIR_TEST/operator-mismatch.sql" <<'SQL'
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO ai_platform.dev_gpt02_task_attempt_binding_claims
(tenant_id,core_command_id,core_coding_task_id,hub_execution_job_id,hub_ai_task_id,
 attempt_id,attempt_number,worker_id,assignee_namespace,assignee_id,owner_namespace,
 accountable_owner_id,evidence_sha256,evidence_source,operator_user_id,recorded_by,source_observed_at,receiver_observed_at)
VALUES ('default','cf8b3f19-a268-428f-8b43-73190c2f9112',gen_random_uuid(),
 '0e52df74-8bb0-4767-a311-5ddff5df45e4',54,
 'ec7157c8-43df-4da3-8971-ff4e4d180b50',1,'openclaw-dell-chatgpt-wake-dev',
 'ai_task_hub.public.ai_tasks.assigned_to_id',8,'ai_task_hub.accountable_owner',
 'synthetic-owner-3',repeat('7',64),'independent_dev_attestation',301,'internal:301',now(),now());
INSERT INTO ai_platform.dev_gpt02_binding_attestation_nonces
(nonce,tenant_id,core_command_id,hub_execution_job_id,attempt_id,operator_user_id,evidence_sha256,attestation_sha256,issued_at,expires_at)
VALUES (gen_random_uuid(),'default','cf8b3f19-a268-428f-8b43-73190c2f9112',
 '0e52df74-8bb0-4767-a311-5ddff5df45e4',
 'ec7157c8-43df-4da3-8971-ff4e4d180b50',302,
 repeat('7',64),repeat('8',64),now(),now()+interval '60 seconds');
COMMIT;
SQL
if docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d isolated < "$TMPDIR_TEST/operator-mismatch.sql" > "$TMPDIR_TEST/operator-mismatch.log" 2>&1; then echo 'OPERATOR_MISMATCH_COMMITTED'; exit 2; fi
grep -q 'violates foreign key constraint "dev_gpt02_nonce_binding_provenance_fk"' "$TMPDIR_TEST/operator-mismatch.log" || { echo 'OPERATOR_MISMATCH_WRONG_ERROR'; tail -12 "$TMPDIR_TEST/operator-mismatch.log"; exit 2; }
echo 'MISMATCHED_OPERATOR_NONCE_DENIED_PASS'
# A binding claiming operator 301 must never label its audit actor as 302.
cat > "$TMPDIR_TEST/operator-spoof.sql" <<'SQL'
\set ON_ERROR_STOP on
INSERT INTO ai_platform.dev_gpt02_task_attempt_binding_claims
(tenant_id,core_command_id,core_coding_task_id,hub_execution_job_id,hub_ai_task_id,
 attempt_id,attempt_number,worker_id,assignee_namespace,assignee_id,owner_namespace,
 accountable_owner_id,evidence_sha256,evidence_source,operator_user_id,recorded_by,source_observed_at,receiver_observed_at)
VALUES ('default',gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),57,
 gen_random_uuid(),1,'openclaw-dell-chatgpt-wake-dev',
 'ai_task_hub.public.ai_tasks.assigned_to_id',8,'ai_task_hub.accountable_owner',
 'synthetic-owner-4',repeat('9',64),'independent_dev_attestation',301,'internal:302',now(),now());
SQL
if docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d isolated < "$TMPDIR_TEST/operator-spoof.sql" > "$TMPDIR_TEST/operator-spoof.log" 2>&1; then echo 'AUDIT_OPERATOR_SPOOF_ACCEPTED'; exit 2; fi
grep -q 'violates check constraint "claim_recorded_by_operator_identity"' "$TMPDIR_TEST/operator-spoof.log" || { echo 'AUDIT_OPERATOR_WRONG_ERROR'; tail -12 "$TMPDIR_TEST/operator-spoof.log"; exit 2; }
echo 'RECORDED_BY_OPERATOR_SPOOF_DENIED_PASS'
N=$(docker exec "$NAME" psql -X -At -v ON_ERROR_STOP=1 -U postgres -d isolated -c "SELECT (SELECT count(*) FROM ai_platform.dev_gpt02_task_attempt_binding_claims),(SELECT count(*) FROM ai_platform.dev_gpt02_binding_attestation_nonces)")
[[ "$N" == '1|1' ]] || { echo "OPERATOR_SPOOF_LEFT_PARTIAL_DATA:$N"; exit 2; }
echo 'OPERATOR_MISMATCH_ROLLBACK_PASS'
