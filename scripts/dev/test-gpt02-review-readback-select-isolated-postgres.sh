#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
name="gpt02-readback-rls-$$"
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || :; }
trap cleanup EXIT
docker run -d --name "$name" --network none --tmpfs /var/lib/postgresql/data:rw,size=128m \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
for n in $(seq 1 40); do docker exec "$name" pg_isready -U postgres -q && break; sleep 1; done
docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
CREATE ROLE aicore_dev_runtime NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA ai_platform;
GRANT USAGE ON SCHEMA ai_platform TO aicore_dev_runtime;
CREATE TABLE ai_platform.dev_gpt02_operator_review_intents(id integer PRIMARY KEY, proof_json jsonb);
INSERT INTO ai_platform.dev_gpt02_operator_review_intents VALUES(1,'{"synthetic":true}');
ALTER TABLE ai_platform.dev_gpt02_operator_review_intents ENABLE ROW LEVEL SECURITY;
SQL
migration=docs/dev/gpt02-operator-review-readback-select.dev.sql
for iteration in 1 2; do
  docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 -q < "$migration"
  echo "IDEMPOTENT APPLY $iteration PASS"
done
actual="$(docker exec "$name" psql -U postgres -qAt -c "SELECT has_table_privilege('aicore_dev_runtime','ai_platform.dev_gpt02_operator_review_intents','SELECT'),has_table_privilege('aicore_dev_runtime','ai_platform.dev_gpt02_operator_review_intents','INSERT'),has_table_privilege('aicore_dev_runtime','ai_platform.dev_gpt02_operator_review_intents','UPDATE'),has_table_privilege('aicore_dev_runtime','ai_platform.dev_gpt02_operator_review_intents','DELETE'),has_table_privilege('anon','ai_platform.dev_gpt02_operator_review_intents','SELECT'),has_table_privilege('authenticated','ai_platform.dev_gpt02_operator_review_intents','SELECT');")"
[ "$actual" = "t|f|f|f|f|f" ] || { echo "FAIL permissions: $actual";exit 1; }
echo "TABLE PERMISSIONS PASS"
readback="$(docker exec "$name" psql -U postgres -qAt -c 'SET ROLE aicore_dev_runtime; SELECT count(*) FROM ai_platform.dev_gpt02_operator_review_intents; RESET ROLE;')"
[ "$readback" = "1" ] || { echo "FAIL SELECT readback: $readback";exit 1; }
echo "RLS SELECT PASS"
for verb in INSERT UPDATE DELETE; do
  case "$verb" in
    INSERT) stmt="INSERT INTO ai_platform.dev_gpt02_operator_review_intents VALUES(2,'{}')";;
    UPDATE) stmt="UPDATE ai_platform.dev_gpt02_operator_review_intents SET proof_json='{}'";;
    DELETE) stmt="DELETE FROM ai_platform.dev_gpt02_operator_review_intents";;
  esac
  if docker exec "$name" psql -U postgres -v ON_ERROR_STOP=1 -q -c "SET ROLE aicore_dev_runtime; $stmt" >/dev/null 2>&1; then
    echo "FAIL $verb allowed";exit 1
  fi
  echo "DENY $verb PASS"
done
docker exec "$name" psql -U postgres -q -c "ALTER POLICY dev_gpt02_review_runtime_select ON ai_platform.dev_gpt02_operator_review_intents USING (false)" >/dev/null
if docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 -q < "$migration" >/dev/null 2>&1; then
  echo "FAIL policy drift silently accepted";exit 1
fi
echo "POLICY DRIFT DETECTED PASS"
echo "ISOLATED POSTGRES RLS REVIEW READBACK PASS — no DEV/PROD changes"
