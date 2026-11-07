#!/usr/bin/env bash
# DEV ONLY: Validate actual guarded audit INSERT predicate under a concurrent
# command-state UPDATE. All rows and approvals here are SYNTHETIC in a disposable
# local PostgreSQL 16 container. No production/CST-DEV connection is used.
set -euo pipefail
NAME="gpt02-audit-race-$$"
DIR="$(mktemp -d /tmp/gpt02-audit-race.XXXXXX)"
cleanup(){ docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
docker run -d --name "$NAME" --network none --tmpfs /var/lib/postgresql/data:rw,size=256m --shm-size 64m -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
for i in $(seq 1 40); do docker exec "$NAME" pg_isready -q -U postgres && break || sleep 1; done
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE SCHEMA ai_platform;
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
CREATE TABLE ai_platform.ai_coding_bridge_commands (
 id uuid PRIMARY KEY, status text NOT NULL, metadata_json jsonb NOT NULL
);
CREATE TABLE ai_platform.ai_coding_bridge_responses (
 id uuid PRIMARY KEY,command_id uuid NOT NULL REFERENCES ai_platform.ai_coding_bridge_commands(id),
 kind text NOT NULL,created_at timestamptz NOT NULL,acknowledged_at timestamptz
);
CREATE TABLE ai_platform.internal_users(
 id integer PRIMARY KEY,role text NOT NULL,status text NOT NULL,
 account_type text NOT NULL,must_change_password boolean NOT NULL
);
INSERT INTO ai_platform.ai_coding_bridge_commands VALUES
('169a7492-cfd8-4a56-bb57-18001b6b5968','PROCESSING',
 '{"devOnly":true,"capability":"chatgpt:wake","assignedClientId":"openclaw-dell-chatgpt-wake-dev"}');
INSERT INTO ai_platform.ai_coding_bridge_responses VALUES
('822efca2-7428-428a-ac66-548c0462438e','169a7492-cfd8-4a56-bb57-18001b6b5968','CHECKPOINT',now()-interval '15 seconds',now()-interval '14 seconds'),
('08b7b237-7a16-46d0-b79d-029d0363c112','169a7492-cfd8-4a56-bb57-18001b6b5968','BLOCKER',now()-interval '10 seconds',NULL);
INSERT INTO ai_platform.internal_users VALUES(7,'admin','active','internal',false);
SQL
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q < docs/dev/gpt02-operator-review-intents.storage.sql
# The synthetic 64-character nonce is not an authenticated review; this
# query is an independent SQL-level reproduction of the app's INSERT predicate.
cat > "$DIR/insert.sql" <<'SQL'
SET lock_timeout='5s';
INSERT INTO ai_platform.dev_gpt02_operator_review_intents
(command_id,checkpoint_response_id,blocker_response_id,operator_user_id,operator_role,worker_id,nonce,proof_json,signed_at,expires_at)
SELECT c.id,cp.id,bl.id,u.id,u.role,'openclaw-dell-chatgpt-wake-dev',
 '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
 jsonb_build_object('version',1,'action','gpt02.resume.grant.review',
 'commandId',c.id,'checkpointResponseId',cp.id,'blockerResponseId',bl.id,
 'workerId','openclaw-dell-chatgpt-wake-dev','operatorId','internal:7',
 'operatorRole','admin','nonce','0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
 'issuedAt','2026-11-08T00:00:00Z','expiresAt','2026-11-08T00:01:00Z',
 'signatureBase64',repeat('A',86)||'=='),
 clock_timestamp(),clock_timestamp()+interval '60s'
FROM (
 SELECT id,status,metadata_json FROM ai_platform.ai_coding_bridge_commands
 WHERE id='169a7492-cfd8-4a56-bb57-18001b6b5968'::uuid FOR UPDATE
) c
JOIN ai_platform.ai_coding_bridge_responses cp
 ON cp.command_id=c.id AND cp.id='822efca2-7428-428a-ac66-548c0462438e'::uuid AND cp.kind='CHECKPOINT'
JOIN ai_platform.ai_coding_bridge_responses bl
 ON bl.command_id=c.id AND bl.id='08b7b237-7a16-46d0-b79d-029d0363c112'::uuid AND bl.kind='BLOCKER'
JOIN ai_platform.internal_users u
 ON u.id=7 AND u.role='admin' AND u.status='active' AND u.account_type='internal'
 AND u.must_change_password IS FALSE
WHERE c.status='PROCESSING'
 AND c.metadata_json->>'devOnly'='true'
 AND c.metadata_json->>'capability'='chatgpt:wake'
 AND c.metadata_json->>'assignedClientId'='openclaw-dell-chatgpt-wake-dev'
 AND cp.acknowledged_at IS NOT NULL AND cp.created_at<bl.created_at
 AND bl.id=(SELECT r.id FROM ai_platform.ai_coding_bridge_responses r WHERE r.command_id=c.id ORDER BY r.created_at DESC,r.id DESC LIMIT 1)
 AND NOT EXISTS (SELECT 1 FROM ai_platform.ai_coding_bridge_responses t
  WHERE t.command_id=c.id AND t.kind IN ('FAILED','COMPLETED'))
 AND clock_timestamp()<clock_timestamp()+interval '60s'
RETURNING id;
SQL
# Hold command row lock while a different backend attempts the audit insert.
# The waiter must re-read the post-commit terminal command state and insert 0.
cat > "$DIR/terminal.sql" <<'SQL'
BEGIN;
UPDATE ai_platform.ai_coding_bridge_commands SET status='FAILED'
WHERE id='169a7492-cfd8-4a56-bb57-18001b6b5968'::uuid;
SELECT pg_sleep(2);
COMMIT;
SQL
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q < "$DIR/terminal.sql" > "$DIR/terminal.out" 2>&1 &
WRITER=$!
sleep 0.4
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -qAt < "$DIR/insert.sql" > "$DIR/insert.out" 2>&1 &
REVIEW=$!
wait "$WRITER"
wait "$REVIEW"
rows="$(docker exec "$NAME" psql -U postgres -qAt -c 'SELECT COUNT(*) FROM ai_platform.dev_gpt02_operator_review_intents;')"
status="$(docker exec "$NAME" psql -U postgres -qAt -c "SELECT status FROM ai_platform.ai_coding_bridge_commands WHERE id='169a7492-cfd8-4a56-bb57-18001b6b5968';")"
if [[ "$rows" != 0 || "$status" != FAILED ]]; then
 echo "FAIL: audit inserted despite committed terminal command: rows=$rows status=$status"
 cat "$DIR/insert.out"; exit 1
fi
echo "PASS: terminal UPDATE commits first => audit INSERT 0 rows"
# Reverse serialization order: approval audit commits while command is
# PROCESSING, and a terminal update arrives while audit holds the row lock.
# A historical audit row may remain, but it MUST NOT imply resume authority.
docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -c "UPDATE ai_platform.ai_coding_bridge_commands SET status='PROCESSING' WHERE id='169a7492-cfd8-4a56-bb57-18001b6b5968'::uuid;" > "$DIR/reset.out" 2>&1
{ echo 'BEGIN;'; cat "$DIR/insert.sql"; echo 'SELECT pg_sleep(2);'; echo 'COMMIT;'; } > "$DIR/audit-first.sql"
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -qAt < "$DIR/audit-first.sql" > "$DIR/audit-first.out" 2>&1 &
AUDITOR=$!
sleep 0.4
docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -c "SET lock_timeout='5s'; UPDATE ai_platform.ai_coding_bridge_commands SET status='FAILED' WHERE id='169a7492-cfd8-4a56-bb57-18001b6b5968'::uuid;" > "$DIR/terminal-second.out" 2>&1 &
TERMINAL=$!
wait "$AUDITOR"
wait "$TERMINAL"
rows="$(docker exec "$NAME" psql -U postgres -qAt -c 'SELECT COUNT(*) FROM ai_platform.dev_gpt02_operator_review_intents;')"
status="$(docker exec "$NAME" psql -U postgres -qAt -c "SELECT status FROM ai_platform.ai_coding_bridge_commands WHERE id='169a7492-cfd8-4a56-bb57-18001b6b5968';")"
if [[ "$rows" != 1 || "$status" != FAILED ]]; then
 echo "FAIL: audit-first state unexpected: rows=$rows status=$status"
 cat "$DIR/audit-first.out" "$DIR/terminal-second.out";exit 1
fi
# Durable review audit does not grant resume; a terminal status must stay
# terminal, and the audit row is immutable historical evidence.
if docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -c "DELETE FROM ai_platform.dev_gpt02_operator_review_intents;" > "$DIR/delete.out" 2>&1;then
 echo "FAIL: historical review audit was deletable";exit 1
fi
grep -q 'GPT02_REVIEW_INTENT_AUDIT_IMMUTABLE' "$DIR/delete.out" || {
 echo "FAIL: delete denied for the wrong reason";cat "$DIR/delete.out";exit 1;
}
echo "PASS: audit INSERT commits first => 1 immutable historical row; later terminal UPDATE => FAILED"
echo "NOT tested: signed native ACK, authenticated operator session, actual grant/worker dispatch"
