#!/usr/bin/env bash
# Applies the EXACT CST-DEV evidence and non-login writer migrations only in
# a disposable PostgreSQL instance. No network access or real credentials.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
N="gpt02-schema-nologin-ci-$$"
cleanup(){ docker rm -f "$N" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --network none --name "$N" --tmpfs /var/lib/postgresql/data:rw,size=256m \
 -e POSTGRES_PASSWORD=synthetic -e POSTGRES_DB=synthetic postgres:16-alpine >/dev/null
ready=false
for i in $(seq 1 35);do
 if docker exec "$N" psql -X -qAt -U postgres -d synthetic -c 'SELECT 1' 2>/dev/null | grep -qx 1;then ready=true;break;fi
 sleep .3
done
test "$ready" = true || { echo TEST_POSTGRES_NOT_READY >&2;exit 2; }
docker exec -i "$N" psql -X -v ON_ERROR_STOP=1 -U postgres -d synthetic >/dev/null <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA ai_platform;
CREATE TABLE ai_platform.ai_coding_bridge_commands (id uuid PRIMARY KEY);
SQL
for file in \
  scripts/dev/migrations/20261109_gpt02_evidence_storage_no_authority.sql \
  scripts/dev/migrations/20261109_gpt02_writer_nologin_no_authority.sql;do
 docker exec -i "$N" psql -X -v ON_ERROR_STOP=1 -U postgres -d synthetic < "$ROOT/$file" >/dev/null
done
CHECK="$(docker exec "$N" psql -X -qAt -U postgres -d synthetic <<'SQL'
SELECT (
  (SELECT rolcanlogin IS FALSE AND rolsuper IS FALSE AND rolbypassrls IS FALSE
    FROM pg_roles WHERE rolname='dev_gpt02_claim_writer_nologin')
  AND has_table_privilege('dev_gpt02_claim_writer_nologin',
    'ai_platform.dev_gpt02_task_attempt_binding_claims','INSERT')
  AND has_table_privilege('dev_gpt02_claim_writer_nologin',
    'ai_platform.dev_gpt02_binding_attestation_nonces','INSERT')
  AND NOT has_table_privilege('dev_gpt02_claim_writer_nologin',
    'ai_platform.dev_gpt02_task_attempt_binding_claims','SELECT,UPDATE,DELETE')
  AND NOT has_table_privilege('dev_gpt02_claim_writer_nologin',
    'ai_platform.dev_gpt02_binding_attestation_nonces','SELECT,UPDATE,DELETE')
  AND NOT has_table_privilege('anon','ai_platform.dev_gpt02_task_attempt_binding_claims','INSERT')
  AND NOT has_table_privilege('authenticated','ai_platform.dev_gpt02_binding_attestation_nonces','INSERT')
  AND NOT has_table_privilege('service_role','ai_platform.dev_gpt02_task_attempt_binding_claims','INSERT')
  AND (SELECT count(*)=0 FROM ai_platform.dev_gpt02_task_attempt_binding_claims)
  AND (SELECT count(*)=0 FROM ai_platform.dev_gpt02_binding_attestation_nonces)
  AND (SELECT count(*)=1 FROM pg_constraint WHERE conname='dev_gpt02_nonce_binding_provenance_fk'
    AND condeferrable)
);
SQL
)"
test "$CHECK" = t || { echo INERT_WRITER_SCHEMA_GUARD_FAILED >&2;exit 3; }
echo GPT02_NOLOGIN_WRITER_SCHEMA_PERMISSIONS_PASS
# PostgreSQL 17 may grant the role creator role-admin membership; the
# production guard permits only postgres, never any app role.
docker exec "$N" psql -X -v ON_ERROR_STOP=1 -U postgres -d synthetic -c \
 'GRANT dev_gpt02_claim_writer_nologin TO postgres;' >/dev/null
docker exec -i "$N" psql -X -v ON_ERROR_STOP=1 -U postgres -d synthetic >/dev/null <<'SQL'
DO $check$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_auth_members m
    JOIN pg_roles r ON r.oid=m.roleid
    JOIN pg_roles member_role ON member_role.oid=m.member
    WHERE r.rolname='dev_gpt02_claim_writer_nologin'
      AND member_role.rolname <> 'postgres')
 THEN RAISE EXCEPTION 'UNSAFE_ROLE_MEMBER';END IF;
END $check$;
SQL
echo GPT02_CREATOR_ONLY_MEMBERSHIP_PASS
# Reapplying this guarded migration must not silently rewrite ownership.
if docker exec -i "$N" psql -X -v ON_ERROR_STOP=1 -U postgres -d synthetic \
  < "$ROOT/scripts/dev/migrations/20261109_gpt02_writer_nologin_no_authority.sql" >/dev/null 2>&1;then
 echo ROLE_MIGRATION_REPLAY_UNEXPECTEDLY_SUCCEEDED >&2;exit 4
fi
echo GPT02_ROLE_MIGRATION_REPLAY_DENIED_PASS
echo GPT02_INERT_DEV_SCHEMA_AND_ROLE_3_OF_3_PASS
