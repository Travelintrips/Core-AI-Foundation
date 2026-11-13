#!/usr/bin/env bash
# Real LOGIN isolation against disposable PostgreSQL. DEV/PROD are untouched.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NAME="gpt02-credential-boundary-$$"
D="$(mktemp -d)"
chmod 700 "$D"
cleanup(){ docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$D"; }
trap cleanup EXIT
docker run --rm -d --network none --name "$NAME" --tmpfs /var/lib/postgresql/data:rw,size=256m \
  -e POSTGRES_PASSWORD=isolated-only -e POSTGRES_DB=synthetic postgres:16-alpine >/dev/null
ready=0
for i in $(seq 1 40); do
  if docker exec "$NAME" psql -U postgres -d synthetic -Atqc 'select 1' 2>/dev/null | grep -qx 1; then ready=1; break; fi
  sleep 0.3
done
test "$ready" = 1 || { echo ISOLATED_DATABASE_NOT_READY; exit 2; }
for f in docs/dev/gpt02-task-attempt-binding.proposed.sql docs/dev/gpt02-binding-attestation-nonces.proposed.sql; do
 docker exec -i "$NAME" psql -X -U postgres -d synthetic -v ON_ERROR_STOP=1 < "$ROOT/$f" > /dev/null
done
# Exercise distinct database LOGIN sessions, not superuser SET ROLE impersonation.
# Passwords exist only inside this temporary container, and are never printed.
cat >"$D/roles.sql" <<'SQL'
\set ON_ERROR_STOP on
CREATE ROLE gpt02_isolated_login_writer LOGIN PASSWORD 'test-writer-ephemeral-only' NOINHERIT;
CREATE ROLE gpt02_isolated_login_reader LOGIN PASSWORD 'test-reader-ephemeral-only' NOINHERIT;
CREATE ROLE gpt02_isolated_login_app LOGIN PASSWORD 'test-app-ephemeral-only' NOINHERIT;
GRANT CONNECT ON DATABASE synthetic TO gpt02_isolated_login_writer,gpt02_isolated_login_reader,gpt02_isolated_login_app;
GRANT USAGE ON SCHEMA ai_platform TO gpt02_isolated_login_writer,gpt02_isolated_login_reader;
GRANT INSERT ON ai_platform.dev_gpt02_task_attempt_binding_claims,
 ai_platform.dev_gpt02_binding_attestation_nonces TO gpt02_isolated_login_writer;
GRANT SELECT ON ai_platform.dev_gpt02_task_attempt_binding_claims,
 ai_platform.dev_gpt02_binding_attestation_nonces TO gpt02_isolated_login_reader;
-- Application user intentionally has no schema usage and no table rights.
DO $x$
DECLARE role_name text;
BEGIN
 FOR role_name IN SELECT unnest(ARRAY[
   'gpt02_isolated_login_writer','gpt02_isolated_login_reader','gpt02_isolated_login_app'])
 LOOP
  IF (SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb FROM pg_roles WHERE rolname=role_name)
    THEN RAISE EXCEPTION 'PRIVILEGED_LOGIN_ROLE:%',role_name; END IF;
 END LOOP;
 IF has_table_privilege('gpt02_isolated_login_writer','ai_platform.dev_gpt02_binding_attestation_nonces','SELECT')
    OR has_table_privilege('gpt02_isolated_login_writer','ai_platform.dev_gpt02_binding_attestation_nonces','UPDATE')
    OR has_table_privilege('gpt02_isolated_login_reader','ai_platform.dev_gpt02_binding_attestation_nonces','INSERT')
    OR has_table_privilege('gpt02_isolated_login_app','ai_platform.dev_gpt02_task_attempt_binding_claims','INSERT')
    THEN RAISE EXCEPTION 'ROLE_PRIVILEGE_DRIFT'; END IF;
END;$x$;
SQL
docker exec -i "$NAME" psql -X -U postgres -d synthetic -v ON_ERROR_STOP=1 < "$D/roles.sql" > /dev/null
run_as(){
 local role="$1" password="$2" sqlfile="$3"
 docker exec -i -e "PGPASSWORD=$password" "$NAME" \
  psql -X -h 127.0.0.1 -U "$role" -d synthetic -v ON_ERROR_STOP=1 -qAt < "$sqlfile"
}
cat >"$D/claim.sql" <<'SQL'
BEGIN;
INSERT INTO ai_platform.dev_gpt02_binding_attestation_nonces
(nonce,tenant_id,core_command_id,hub_execution_job_id,attempt_id,operator_user_id,
evidence_sha256,attestation_sha256,issued_at,expires_at)
VALUES ('83db99f5-cbda-4e60-be71-3090fb411bbb','default',
'4eb75fa9-f9e4-4573-8e00-d3084b4c2c8a','1c728fe5-5e9d-4328-9cea-e5ca221c1004',
'92d4578f-fd3c-4381-83c8-229bb208d24f',301,repeat('a',64),repeat('b',64),now(),now()+interval '90 seconds');
INSERT INTO ai_platform.dev_gpt02_task_attempt_binding_claims
(id,tenant_id,core_command_id,core_coding_task_id,hub_execution_job_id,hub_ai_task_id,
attempt_id,attempt_number,worker_id,assignee_namespace,assignee_id,owner_namespace,
accountable_owner_id,evidence_sha256,evidence_source,operator_user_id,recorded_by,
source_observed_at,receiver_observed_at)
VALUES ('842dd17e-471b-42fc-90bf-eb0ee34b5f8e','default',
'4eb75fa9-f9e4-4573-8e00-d3084b4c2c8a','75c128d5-f697-4344-b2cc-43d8eb625077',
'1c728fe5-5e9d-4328-9cea-e5ca221c1004',135,
'92d4578f-fd3c-4381-83c8-229bb208d24f',1,'openclaw-dell-chatgpt-wake-dev',
'ai_task_hub.public.ai_tasks.assigned_to_id',7,'ai_task_hub.accountable_owner',
'synthetic-owner',repeat('a',64),'independent_dev_attestation',301,'internal:301',now(),now());
COMMIT;
SQL
run_as gpt02_isolated_login_writer test-writer-ephemeral-only "$D/claim.sql" >/dev/null
echo ISOLATED_LOGIN_WRITER_ATOMIC_COMMIT_PASS
cat >"$D/read.sql" <<'SQL'
SELECT count(*) FROM ai_platform.dev_gpt02_binding_attestation_nonces n
JOIN ai_platform.dev_gpt02_task_attempt_binding_claims b
ON b.core_command_id=n.core_command_id AND b.attempt_id=n.attempt_id
WHERE n.may_issue_grant=false AND n.may_dispatch_worker=false
AND b.binding_verified=false AND b.may_dispatch_worker=false AND b.may_close_job=false;
SQL
[[ "$(run_as gpt02_isolated_login_reader test-reader-ephemeral-only "$D/read.sql")" = 1 ]] || exit 5
echo SEPARATE_LOGIN_READER_READBACK_PASS
deny(){
 local label="$1" role="$2" pw="$3" statement="$4"
 printf '%s\n' "$statement" >"$D/denied.sql"
 if run_as "$role" "$pw" "$D/denied.sql" > "$D/stdout" 2>"$D/stderr"; then
  echo "UNAUTHORIZED_OPERATION_ACCEPTED:$label"; exit 6
 fi
 grep -Eq 'permission denied|must be owner' "$D/stderr" || {
  echo "WRONG_REJECTION:$label"; cat "$D/stderr"; exit 7;
 }
 echo "${label}_DENIED_PASS"
}
deny APP_INSERT gpt02_isolated_login_app test-app-ephemeral-only \
 "INSERT INTO ai_platform.dev_gpt02_task_attempt_binding_claims(id) VALUES(gen_random_uuid());"
deny READER_INSERT gpt02_isolated_login_reader test-reader-ephemeral-only \
 "INSERT INTO ai_platform.dev_gpt02_binding_attestation_nonces(nonce) VALUES(gen_random_uuid());"
deny WRITER_SELECT gpt02_isolated_login_writer test-writer-ephemeral-only \
 "SELECT count(*) FROM ai_platform.dev_gpt02_task_attempt_binding_claims;"
deny WRITER_UPDATE gpt02_isolated_login_writer test-writer-ephemeral-only \
 "UPDATE ai_platform.dev_gpt02_task_attempt_binding_claims SET recorded_by='internal:999';"
deny WRITER_DELETE gpt02_isolated_login_writer test-writer-ephemeral-only \
 "DELETE FROM ai_platform.dev_gpt02_binding_attestation_nonces;"
deny APP_ASSUME_WRITER gpt02_isolated_login_app test-app-ephemeral-only \
 "SET ROLE gpt02_isolated_login_writer;"
# Passwords and role membership are NOT deployed. This test shows only the
# actual DB authentication + privilege boundary, not a trusted issuer.
echo GPT02_DISTINCT_LOGIN_ATOMIC_BOUNDARY_8_OF_8_PASS_NO_RUNTIME_AUTHORITY
