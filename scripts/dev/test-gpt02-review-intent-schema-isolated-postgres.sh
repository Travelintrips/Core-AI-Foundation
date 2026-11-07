#!/usr/bin/env bash
# PostgreSQL 16 isolated schema parity test for DEV-only review-intent audit.
# Runs against a throwaway DB, NEVER CST-DEV/PROD or a real approval.
set -euo pipefail
NAME="gpt02-audit-schema-$$"
WORK="$(mktemp -d /tmp/gpt02-audit.XXXXXX)"
cleanup(){ docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
docker run -d --name "$NAME" --network none --tmpfs /var/lib/postgresql/data:rw,size=256m \
 --shm-size 64m -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
for i in $(seq 1 40); do docker exec "$NAME" pg_isready -q -U postgres && break || sleep 1; done
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE SCHEMA ai_platform;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE TABLE ai_platform.ai_coding_bridge_commands(id uuid PRIMARY KEY);
CREATE TABLE ai_platform.ai_coding_bridge_responses(id uuid PRIMARY KEY,command_id uuid NOT NULL REFERENCES ai_platform.ai_coding_bridge_commands(id));
CREATE TABLE ai_platform.internal_users(id integer PRIMARY KEY);
INSERT INTO ai_platform.ai_coding_bridge_commands VALUES ('169a7492-cfd8-4a56-bb57-18001b6b5968'),('28e38692-73c0-470e-aaea-51894504a5f0');
INSERT INTO ai_platform.ai_coding_bridge_responses VALUES
 ('822efca2-7428-428a-ac66-548c0462438e','169a7492-cfd8-4a56-bb57-18001b6b5968'),
 ('08b7b237-7a16-46d0-b79d-029d0363c112','169a7492-cfd8-4a56-bb57-18001b6b5968'),
 ('1d76b73c-9cda-46fa-af10-61b56ebae59c','28e38692-73c0-470e-aaea-51894504a5f0');
INSERT INTO ai_platform.internal_users VALUES (7);
SQL
# Execute the EXACT checked-in migration SQL rather than a copied schema.
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q < docs/dev/gpt02-operator-review-intents.storage.sql
cat >"$WORK/valid.sql" <<'SQL'
INSERT INTO ai_platform.dev_gpt02_operator_review_intents
 (command_id,checkpoint_response_id,blocker_response_id,operator_user_id,operator_role,worker_id,nonce,proof_json,signed_at,expires_at)
 VALUES
 ('169a7492-cfd8-4a56-bb57-18001b6b5968',
  '822efca2-7428-428a-ac66-548c0462438e',
  '08b7b237-7a16-46d0-b79d-029d0363c112',
  7,'admin','openclaw-dell-chatgpt-wake-dev',
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  '{"action":"gpt02.resume.grant.review","synthetic":true}'::jsonb,
  clock_timestamp()-interval '2 seconds',clock_timestamp()+interval '60 seconds');
SQL
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q <"$WORK/valid.sql"
if docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q <"$WORK/valid.sql" >"$WORK/replay" 2>&1; then
 echo "FAIL: duplicate nonce accepted";exit 1
fi
echo "UNIQUE NONCE PASS"
# Run independent negative transactions: each must fail and keep count=1.
CASE_COUNTER=0
test_deny(){
 local label="$1" statement="$2" expected="$3"
 # Use a unique nonce for each negative test so uniqueness cannot mask other failures.
 local suffix
 CASE_COUNTER=$((CASE_COUNTER+1))
 suffix="$(printf "%064x" "$CASE_COUNTER")"
 statement="${statement//0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef/$suffix}"
 if docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -c "$statement" >"$WORK/error" 2>&1; then
   echo "FAIL: $label accepted";exit 1
 fi
 if ! grep -F "$expected" "$WORK/error" >/dev/null; then
   echo "FAIL: $label rejected for unexpected reason"; cat "$WORK/error";exit 1
 fi
 echo "$label PASS"
}
# Substitute into valid SQL; use fresh nonce for each to test intended constraint.
base="$(cat "$WORK/valid.sql")"
test_deny "WRONG ROLE" "$(printf '%s\n' "$base" | sed "s|'admin'|'manager'|")" "violates check constraint"
test_deny "WRONG WORKER" "$(printf '%s\n' "$base" | sed "s|'openclaw-dell-chatgpt-wake-dev'|'other-worker'|")" "violates check constraint"
test_deny "WRONG OPERATOR FK" "$(printf '%s\n' "$base" | sed "s|7,'admin'|999,'admin'|")" "violates foreign key constraint"
test_deny "CROSS CHECKPOINT ID" "$(printf '%s\n' "$base" | sed "s|822efca2-7428-428a-ac66-548c0462438e|00000000-0000-4000-8000-000000000001|")" "violates foreign key constraint"
test_deny "MISSING BLOCKER FK" "$(printf '%s\n' "$base" | sed "s|08b7b237-7a16-46d0-b79d-029d0363c112|00000000-0000-4000-8000-000000000002|")" "violates foreign key constraint"
test_deny "MALFORMED NONCE" "$(printf '%s\n' "$base" | sed "s|0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef|not-a-nonce|")" "violates check constraint"
test_deny "EXPIRED PROOF" "$(printf '%s\n' "$base" | sed "s|clock_timestamp()+interval '60 seconds'|clock_timestamp()-interval '1 second'|")" "violates check constraint"
test_deny "TOO LONG TTL" "$(printf '%s\n' "$base" | sed "s|clock_timestamp()+interval '60 seconds'|clock_timestamp()+interval '200 seconds'|")" "violates check constraint"
test_deny "IDENTICAL RESPONSE IDS" "$(printf '%s\n' "$base" | sed "s|08b7b237-7a16-46d0-b79d-029d0363c112|822efca2-7428-428a-ac66-548c0462438e|")" "violates check constraint"
STATUS="$(docker exec "$NAME" psql -U postgres -qAt -c "SELECT (SELECT count(*) FROM ai_platform.dev_gpt02_operator_review_intents), (SELECT relrowsecurity FROM pg_class WHERE oid='ai_platform.dev_gpt02_operator_review_intents'::regclass), has_table_privilege('anon','ai_platform.dev_gpt02_operator_review_intents','INSERT'),has_table_privilege('authenticated','ai_platform.dev_gpt02_operator_review_intents','INSERT');")"
[ "$STATUS" = "1|t|f|f" ] || { echo "FAIL: readback $STATUS";exit 1; }
echo "SCHEMA SECURITY PASS: exactly one synthetic record, RLS ON, public roles INSERT denied"
echo "AUDIT SCHEMA ISOLATED PASS — not a real signature/ACK, NOT an executable resume grant"
