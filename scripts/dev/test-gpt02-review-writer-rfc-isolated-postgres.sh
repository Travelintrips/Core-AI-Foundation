#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
name="gpt02-writer-rfc-$$"
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || :; }
trap cleanup EXIT
docker run -d --name "$name" --network none --tmpfs /var/lib/postgresql/data:rw,size=128m \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
for n in $(seq 1 40); do docker exec "$name" pg_isready -U postgres -q && break; sleep 1; done
docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE ROLE aicore_dev_runtime NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA ai_platform;
GRANT USAGE ON SCHEMA ai_platform TO aicore_dev_runtime;
CREATE TABLE ai_platform.ai_coding_bridge_commands(id uuid PRIMARY KEY, status text NOT NULL);
INSERT INTO ai_platform.ai_coding_bridge_commands VALUES ('169a7492-cfd8-4a56-bb57-18001b6b5968','PROCESSING');
CREATE TABLE ai_platform.ai_coding_bridge_responses(id uuid PRIMARY KEY);
CREATE TABLE ai_platform.internal_users(id integer PRIMARY KEY);
CREATE TABLE ai_platform.dev_gpt02_operator_review_intents(id integer PRIMARY KEY, proof_json jsonb);
ALTER TABLE ai_platform.dev_gpt02_operator_review_intents ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON ai_platform.dev_gpt02_operator_review_intents TO aicore_dev_runtime;
CREATE POLICY dev_gpt02_review_runtime_select
 ON ai_platform.dev_gpt02_operator_review_intents FOR SELECT TO aicore_dev_runtime USING (true);
SQL
# The exact checked-in RFC must refuse direct execution and rollback.
if docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 -q < docs/dev/gpt02-review-writer-rfc.proposed.sql > /dev/null 2>&1; then
 echo "FAIL: unsafe RFC applied without review";exit 1
fi
role_count="$(docker exec "$name" psql -U postgres -qAt -c "SELECT count(*) FROM pg_roles WHERE rolname='gpt02_dev_review_writer'")"
[ "$role_count" = 0 ] || { echo "FAIL: RFC created writer role despite refusal";exit 1; }
echo "EXACT SQL RFC FAIL-CLOSED PASS"
# Only within this disposable networkless DB, strip the explicit blocker to
# exercise the intentionally unsafe model; never produce a deployable artifact.
work="$(mktemp /tmp/gpt02-rfc-synthetic.XXXXXX)"
trap 'docker rm -f "$name" >/dev/null 2>&1 || :; rm -f "$work"' EXIT
python3 - "$work" <<'INTERNAL'
from pathlib import Path
import sys
s=Path('docs/dev/gpt02-review-writer-rfc.proposed.sql').read_text()
start=s.index('DO $rfc_disabled$')
end=s.index('$rfc_disabled$;',start)+len('$rfc_disabled$;')
assert s.count('DO $rfc_disabled$')==1
Path(sys.argv[1]).write_text(s[:start]+s[end:])
INTERNAL
docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 -q < "$work"
rights="$(docker exec "$name" psql -U postgres -qAt -c "SELECT
has_table_privilege('aicore_dev_runtime','ai_platform.dev_gpt02_operator_review_intents','INSERT'),
has_table_privilege('gpt02_dev_review_writer','ai_platform.dev_gpt02_operator_review_intents','INSERT'),
has_table_privilege('gpt02_dev_review_writer','ai_platform.dev_gpt02_operator_review_intents','UPDATE'),
has_table_privilege('gpt02_dev_review_writer','ai_platform.dev_gpt02_operator_review_intents','DELETE'),
has_table_privilege('gpt02_dev_review_writer','ai_platform.ai_coding_bridge_commands','UPDATE'),
pg_has_role('aicore_dev_runtime','gpt02_dev_review_writer','MEMBER');")"
[ "$rights" = "f|t|f|f|f|f" ] || { echo "FAIL scoped privileges: $rights"; exit 1; }
echo "ROLE ISOLATION PASS"
docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -q -c "SET ROLE gpt02_dev_review_writer; INSERT INTO ai_platform.dev_gpt02_operator_review_intents VALUES (1,'{}')" >/dev/null
echo "INSERT RLS PASS (synthetic, unsigned: NOT E2E approval)"
for sql in "UPDATE ai_platform.dev_gpt02_operator_review_intents SET proof_json='{}'" "DELETE FROM ai_platform.dev_gpt02_operator_review_intents" "UPDATE ai_platform.ai_coding_bridge_commands SET id=gen_random_uuid()"; do
 if docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -q -c "SET ROLE gpt02_dev_review_writer; $sql" >/dev/null 2>&1; then
  echo "FAIL: unauthorized statement accepted"; exit 1
 fi
done
echo "WRITE DENIAL PASS"
# The command lock used by the existing persistence code needs UPDATE privilege.
# SELECT-only must not be mistaken for the same protection.
if docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -q -c  "SET ROLE gpt02_dev_review_writer; SELECT id FROM ai_platform.ai_coding_bridge_commands WHERE id='169a7492-cfd8-4a56-bb57-18001b6b5968' FOR UPDATE" >/dev/null 2>&1; then
 echo "FAIL: dedicated writer unexpectedly acquired FOR UPDATE";exit 1
fi
echo "FOR UPDATE DENIED WITHOUT COMMAND UPDATE PASS"
# PostgreSQL also requires UPDATE privilege for row-locking SELECT modes.
# Do not use weaker lock variants to bypass the command fencing requirement.
if docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -q -c \
 "SET ROLE gpt02_dev_review_writer; SELECT id FROM ai_platform.ai_coding_bridge_commands WHERE id='169a7492-cfd8-4a56-bb57-18001b6b5968' FOR KEY SHARE" >/dev/null 2>&1; then
 echo "FAIL: writer unexpectedly acquired row lock";exit 1
fi
echo "ROW LOCK WITHOUT UPDATE PRIVILEGE DENIED PASS"
if docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -q -c "SET ROLE aicore_dev_runtime; INSERT INTO ai_platform.dev_gpt02_operator_review_intents VALUES (2,'{}')" >/dev/null 2>&1; then
 echo "FAIL: ordinary runtime gained INSERT";exit 1
fi
echo "MAIN RUNTIME INSERT DENIED PASS"
if docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 -q < "$work" >/dev/null 2>&1; then
 echo "FAIL: review-required policy replay not refused";exit 1
fi
echo "POLICY REPLAY FAIL-CLOSED PASS"
echo "RFC ISOLATED PASS — signing/dispatch/writer login NOT enabled"
