#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
NAME="gpt02-scoped-writer-test-$$"
DIR=$(mktemp -d)
cleanup(){ docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
docker run --rm -d --name "$NAME" -e POSTGRES_PASSWORD=test-only -e POSTGRES_DB=isolated postgres:16-alpine >/dev/null
ready=0
for _ in $(seq 1 45); do
 if docker exec "$NAME" psql -X -h 127.0.0.1 -Atqc 'SELECT 1' -U postgres -d isolated -v ON_ERROR_STOP=1 2>/dev/null | grep -qx 1; then ready=1; break; fi
 sleep 1
done
[[ "$ready" == 1 ]] || { echo 'DISPOSABLE_POSTGRES_TCP_UNAVAILABLE'; exit 2; }
for f in "$ROOT/docs/dev/gpt02-task-attempt-binding.proposed.sql" "$ROOT/docs/dev/gpt02-binding-attestation-nonces.proposed.sql"; do
 docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d isolated < "$f" >/dev/null
done
cat > "$DIR/setup.sql" <<'SQL'
\set ON_ERROR_STOP on
CREATE ROLE gpt02_synthetic_claim_writer NOLOGIN;
CREATE ROLE gpt02_synthetic_readback NOLOGIN;
CREATE ROLE gpt02_synthetic_runtime NOLOGIN;
GRANT USAGE ON SCHEMA ai_platform TO gpt02_synthetic_claim_writer,gpt02_synthetic_readback,gpt02_synthetic_runtime;
GRANT INSERT ON ai_platform.dev_gpt02_task_attempt_binding_claims,
 ai_platform.dev_gpt02_binding_attestation_nonces TO gpt02_synthetic_claim_writer;
GRANT SELECT ON ai_platform.dev_gpt02_task_attempt_binding_claims,
 ai_platform.dev_gpt02_binding_attestation_nonces TO gpt02_synthetic_readback;
DO $x$
BEGIN
 IF has_table_privilege('gpt02_synthetic_claim_writer','ai_platform.dev_gpt02_task_attempt_binding_claims','SELECT')
  OR has_table_privilege('gpt02_synthetic_claim_writer','ai_platform.dev_gpt02_binding_attestation_nonces','UPDATE')
  OR has_table_privilege('gpt02_synthetic_claim_writer','ai_platform.dev_gpt02_binding_attestation_nonces','DELETE')
  OR has_table_privilege('gpt02_synthetic_readback','ai_platform.dev_gpt02_task_attempt_binding_claims','INSERT')
  OR has_table_privilege('gpt02_synthetic_runtime','ai_platform.dev_gpt02_task_attempt_binding_claims','INSERT')
 THEN RAISE EXCEPTION 'SYNTHETIC_ROLES_HAVE_EXCESS_PERMISSION'; END IF;
 RAISE NOTICE 'SCOPED_ROLE_PRIVILEGE_SHAPE_PASS';
END;$x$;
SQL
docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d isolated < "$DIR/setup.sql" >/dev/null
cat > "$DIR/insert.sql" <<'SQL'
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE gpt02_synthetic_claim_writer;
INSERT INTO ai_platform.dev_gpt02_binding_attestation_nonces
(nonce,tenant_id,core_command_id,hub_execution_job_id,attempt_id,operator_user_id,evidence_sha256,attestation_sha256,issued_at,expires_at)
VALUES ('0a071ac3-7155-4d22-9d9f-661f593cf3d5','default',
 '2a5371cf-e438-4f7e-8b26-1e4b88dbef45','1e30a8ea-1a48-46e0-a884-6b80172341c4',
 '4b53c51d-de0a-4ba4-afc3-acb33b338a08',301,repeat('a',64),repeat('b',64),now(),now()+interval '90 seconds');
INSERT INTO ai_platform.dev_gpt02_task_attempt_binding_claims
(id,tenant_id,core_command_id,core_coding_task_id,hub_execution_job_id,hub_ai_task_id,
 attempt_id,attempt_number,worker_id,assignee_namespace,assignee_id,owner_namespace,
 accountable_owner_id,evidence_sha256,evidence_source,operator_user_id,recorded_by,
 source_observed_at,receiver_observed_at)
VALUES ('1f645fbc-de4a-4a9c-9e8b-3e4a90ad6328','default',
 '2a5371cf-e438-4f7e-8b26-1e4b88dbef45','dcbeec91-4658-4b61-96cb-46d49cd68d7a',
 '1e30a8ea-1a48-46e0-a884-6b80172341c4',42,
 '4b53c51d-de0a-4ba4-afc3-acb33b338a08',1,'openclaw-dell-chatgpt-wake-dev',
 'ai_task_hub.public.ai_tasks.assigned_to_id',7,'ai_task_hub.accountable_owner',
 'synthetic-owner',repeat('a',64),'independent_dev_attestation',301,'internal:301',now(),now());
COMMIT;
SQL
docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d isolated < "$DIR/insert.sql" > "$DIR/insert.log" 2>&1 || { echo 'SCOPED_WRITER_ATOMIC_INSERT_FAILED'; tail -30 "$DIR/insert.log"; exit 2; }
echo 'SCOPED_NONOWNER_WRITER_COMMIT_PASS'
cat > "$DIR/readback.sql" <<'SQL'
\set ON_ERROR_STOP on
SET ROLE gpt02_synthetic_readback;
SELECT count(*) AS bound FROM ai_platform.dev_gpt02_binding_attestation_nonces n
 JOIN ai_platform.dev_gpt02_task_attempt_binding_claims b
 ON b.tenant_id=n.tenant_id AND b.core_command_id=n.core_command_id
 AND b.hub_execution_job_id=n.hub_execution_job_id AND b.attempt_id=n.attempt_id
 AND b.evidence_sha256=n.evidence_sha256 AND b.operator_user_id=n.operator_user_id
 WHERE n.may_dispatch_worker=false AND n.may_issue_grant=false
 AND b.binding_verified=false AND b.may_dispatch_worker=false AND b.may_close_job=false;
SQL
R=$(docker exec -i "$NAME" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d isolated < "$DIR/readback.sql")
[[ "$R" == 1 ]] || { echo "SCOPED_READBACK_INVALID:$R"; exit 2; }
echo 'INDEPENDENT_SCOPED_READBACK_PASS'
assert_denied(){
 local label="$1" sql="$2" log="$DIR/denied-$1.log"
 if { printf '%s\n' "$sql"; } | docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d isolated > "$log" 2>&1; then
  echo "UNAUTHORIZED_OPERATION_ACCEPTED:$label"; exit 2
 fi
 grep -q 'permission denied' "$log" || { echo "WRONG_REJECTION_REASON:$label"; tail -12 "$log"; exit 2; }
 echo "${label}_DENIED_PASS"
}
assert_denied 'RUNTIME_INSERT' "SET ROLE gpt02_synthetic_runtime; INSERT INTO ai_platform.dev_gpt02_task_attempt_binding_claims (id) VALUES (gen_random_uuid());"
assert_denied 'READER_INSERT' "SET ROLE gpt02_synthetic_readback; INSERT INTO ai_platform.dev_gpt02_binding_attestation_nonces (nonce) VALUES (gen_random_uuid());"
assert_denied 'WRITER_UPDATE' "SET ROLE gpt02_synthetic_claim_writer; UPDATE ai_platform.dev_gpt02_task_attempt_binding_claims SET recorded_by='internal:302';"
assert_denied 'WRITER_DELETE' "SET ROLE gpt02_synthetic_claim_writer; DELETE FROM ai_platform.dev_gpt02_binding_attestation_nonces;"
assert_denied 'WRITER_SELECT' "SET ROLE gpt02_synthetic_claim_writer; SELECT count(*) FROM ai_platform.dev_gpt02_binding_attestation_nonces;"
assert_denied 'READER_UPDATE' "SET ROLE gpt02_synthetic_readback; UPDATE ai_platform.dev_gpt02_binding_attestation_nonces SET may_issue_grant=true;"
echo 'SCOPED_WRITER_ISOLATED_POSTGRES_PASS'
