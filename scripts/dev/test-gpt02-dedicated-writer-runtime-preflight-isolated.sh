#!/usr/bin/env bash
# Integration-only: actually connects from the current Core DEV image to a
# synthetic PostgreSQL 16 server with independent LOGIN credentials.
# No host ports, no real Core DB/APP secrets, no live issuer/worker.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NAME="gpt02-writer-runtime-pg-$$"
NET="gpt02-writer-runtime-net-$$"
IMAGE="${GPT02_TEST_CORE_IMAGE:-}"
test -n "$IMAGE" || { echo GPT02_TEST_CORE_IMAGE_REQUIRED >&2; exit 2; }
TEMP="$(mktemp -d)"
cleanup(){ docker rm -f "$NAME" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; rm -rf "$TEMP"; }
trap cleanup EXIT
docker network create --internal "$NET" >/dev/null
docker run --rm -d --name "$NAME" --network "$NET" --network-alias postgres \
 -e POSTGRES_PASSWORD=isolated-only -e POSTGRES_DB=synthetic \
 --tmpfs /var/lib/postgresql/data:rw,size=256m postgres:16-alpine >/dev/null
ready=0
for _ in $(seq 1 40);do
 if docker exec "$NAME" psql -X -U postgres -d synthetic -Atqc 'SELECT 1' 2>/dev/null | grep -qx 1; then ready=1;break;fi
 sleep .3
done
test "$ready" = 1 || { echo SYNTHETIC_DB_NOT_READY;exit 2; }
for f in docs/dev/gpt02-task-attempt-binding.proposed.sql docs/dev/gpt02-binding-attestation-nonces.proposed.sql;do
 docker exec -i "$NAME" psql -X -U postgres -d synthetic -v ON_ERROR_STOP=1 < "$ROOT/$f" >/dev/null
done
docker exec -i "$NAME" psql -X -U postgres -d synthetic -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE ROLE core_app_synthetic LOGIN PASSWORD 'core-app-isolated-only';
CREATE ROLE gpt02_writer_synthetic LOGIN PASSWORD 'gpt02-writer-isolated-only';
GRANT CONNECT ON DATABASE synthetic TO core_app_synthetic,gpt02_writer_synthetic;
GRANT USAGE ON SCHEMA ai_platform TO gpt02_writer_synthetic;
GRANT INSERT ON ai_platform.dev_gpt02_binding_attestation_nonces,
 ai_platform.dev_gpt02_task_attempt_binding_claims TO gpt02_writer_synthetic;
SQL
run_preflight(){
 local app="$1" writer="$2"
 docker run --rm --network "$NET" --entrypoint node \
   --read-only --security-opt no-new-privileges:true --cap-drop ALL \
   -v "$ROOT/scripts/dev:/audit:ro" \
   -e APP_ENV=development -e NODE_ENV=development \
   -e "SUPABASE_DEV_DATABASE_URL=$app" \
   -e "GPT02_BINDING_WRITER_DATABASE_URL_DEV=$writer" \
   "$IMAGE" -e 'require("/audit/gpt02-dedicated-writer-preflight.cjs").run()'
}
APP='postgresql://core_app_synthetic:core-app-isolated-only@postgres:5432/synthetic'
WRITER='postgresql://gpt02_writer_synthetic:gpt02-writer-isolated-only@postgres:5432/synthetic'
# Real TCP login and permissions: still permanently NO_GO without issuer.
run_preflight "$APP" "$WRITER" > "$TEMP/ready.json"
node -e 'const d=require(process.argv[1]);if(!d.credentialIsolationVerified||d.releaseDecision!=="NO_GO"||d.mayPersistBinding!==false)process.exit(1);console.log("ISOLATED_WRITER_LOGIN_READINESS_PASS_NO_AUTHORITY")' "$TEMP/ready.json"
# Reused application credential must be rejected before any connection.
run_preflight "$APP" "$APP" > "$TEMP/reused.json"
node -e 'const d=require(process.argv[1]);if(d.credentialIsolationVerified||!d.blockingReasons.includes("WRITER_REUSES_CORE_DATABASE_CREDENTIAL"))process.exit(1);console.log("WRITER_CREDENTIAL_REUSE_DENIED_PASS")' "$TEMP/reused.json"
# Excess SELECT privilege must fail the inspection.
docker exec -i "$NAME" psql -X -U postgres -d synthetic -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
GRANT SELECT ON ai_platform.dev_gpt02_binding_attestation_nonces TO gpt02_writer_synthetic;
SQL
run_preflight "$APP" "$WRITER" > "$TEMP/excess.json"
node -e 'const d=require(process.argv[1]);if(d.credentialIsolationVerified||!d.blockingReasons.includes("WRITER_HAS_EXCESS_TABLE_PRIVILEGES"))process.exit(1);console.log("WRITER_EXCESS_PRIVILEGE_DENIED_PASS")' "$TEMP/excess.json"
# A general app LOGIN is not a substitute for the dedicated writer.
run_preflight "$APP" 'postgresql://core_app_synthetic:core-app-isolated-only@postgres:5432/synthetic' > "$TEMP/app.json"
node -e 'const d=require(process.argv[1]);if(d.credentialIsolationVerified||d.mayPersistBinding!==false)process.exit(1);console.log("GENERAL_APP_LOGIN_DENIED_PASS")' "$TEMP/app.json"
echo GPT02_ISOLATED_ACTUAL_WRITER_PREFLIGHT_4_OF_4_PASS_NO_RUNTIME_ISSUER
