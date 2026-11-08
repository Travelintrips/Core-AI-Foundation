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
 accountable_owner_id,evidence_sha256,evidence_source,recorded_by,source_observed_at,receiver_observed_at)
VALUES ('default','a7eb36f0-404b-480d-a42b-17b4250f3149',
 '965604aa-9e6b-478b-8e33-cc52a8f0b8ca',
 '37167f35-53a6-48b2-bec9-ac5ac352748d',42,
 'e942fc15-42c2-4cf3-9359-24369731ae8e',1,'openclaw-dell-chatgpt-wake-dev',
 'ai_task_hub.public.ai_tasks.assigned_to_id',7,'ai_task_hub.accountable_owner',
 'synthetic-owner',repeat('a',64),'independent_dev_attestation','internal:301',now(),now());
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
 accountable_owner_id,evidence_sha256,evidence_source,recorded_by,source_observed_at,receiver_observed_at)
VALUES ('default',gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),48,gen_random_uuid(),1,
 'openclaw-dell-chatgpt-wake-dev','ai_task_hub.public.ai_tasks.assigned_to_id',7,
 'ai_task_hub.accountable_owner','',repeat('e',64),'independent_dev_attestation','internal:301',now(),now());
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
