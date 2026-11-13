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
# The official postgres image has a short-lived initdb server before its
# final restart. pg_isready can briefly succeed during initialization.
for i in $(seq 1 40); do
  if docker exec "$NAME" pg_isready -q -U postgres; then
    sleep 2
    if docker exec "$NAME" psql -U postgres -qAt -c "SELECT 1" 2>/dev/null | grep -qx 1; then break; fi
  fi
  sleep 1
done
docker exec "$NAME" psql -U postgres -qAt -c "SELECT 1" | grep -qx 1
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
# Reproduce the REAL fixed backend: one READ COMMITTED transaction with
# command row lock in statement 1, then fresh response snapshot in statement 2.
{ echo 'BEGIN;'; echo "SET LOCAL lock_timeout='5s';";
  echo "SELECT id FROM ai_platform.ai_coding_bridge_commands WHERE id='169a7492-cfd8-4a56-bb57-18001b6b5968'::uuid FOR UPDATE;";
  tail -n +2 "$DIR/insert.sql";
  echo 'COMMIT;'; } > "$DIR/audit-transaction.sql"
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
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -qAt < "$DIR/audit-transaction.sql" > "$DIR/insert.out" 2>&1 &
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
{ sed '$d' "$DIR/audit-transaction.sql"; echo 'SELECT pg_sleep(2);'; echo 'COMMIT;'; } > "$DIR/audit-first.sql"
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
# Terminal response INSERT can hold a parent FK KEY SHARE lock while
# the audit tries FOR UPDATE; the subsequent INSERT must use a fresh snapshot.
# Run against disposable synthetic rows only, never CST-DEV.
docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -c "TRUNCATE TABLE ai_platform.dev_gpt02_operator_review_intents; UPDATE ai_platform.ai_coding_bridge_commands SET status='PROCESSING' WHERE id='169a7492-cfd8-4a56-bb57-18001b6b5968'::uuid;" > "$DIR/reset-response.out" 2>&1
cat > "$DIR/response-first.sql" <<'SQL'
BEGIN;
INSERT INTO ai_platform.ai_coding_bridge_responses(id,command_id,kind,created_at,acknowledged_at)
VALUES('70c61ea0-8524-4fba-9da5-a88b2467a6a7','169a7492-cfd8-4a56-bb57-18001b6b5968','FAILED',now(),NULL);
SELECT pg_sleep(2);
COMMIT;
SQL
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q < "$DIR/response-first.sql" > "$DIR/response-first.out" 2>&1 &
RESP=$!
sleep 0.4
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -qAt < "$DIR/audit-transaction.sql" > "$DIR/audit-after-response.out" 2>&1 &
AUDIT=$!
wait "$RESP"
wait "$AUDIT"
rows="$(docker exec "$NAME" psql -U postgres -qAt -c 'SELECT COUNT(*) FROM ai_platform.dev_gpt02_operator_review_intents;')"
if [[ "$rows" != 0 ]];then
 echo "FAIL/NO-GO: response committed first but review audit recorded stale response: rows=$rows";exit 27
fi
echo "PASS: terminal response committed before audit acquired lock => 0 audit rows (fresh snapshot)"
# Fourth ordering: once the audit has committed, a new terminal response
# may still be appended. The immutable audit is historical, not a live grant.
docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -c "DELETE FROM ai_platform.ai_coding_bridge_responses WHERE id='70c61ea0-8524-4fba-9da5-a88b2467a6a7';" > "$DIR/reset-terminal-response.out" 2>&1
{ sed '$d' "$DIR/audit-transaction.sql"; echo 'SELECT pg_sleep(2);'; echo 'COMMIT;'; } > "$DIR/audit-before-new-response.sql"
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -qAt < "$DIR/audit-before-new-response.sql" > "$DIR/audit-before-new-response.out" 2>&1 &
AUDITOR4=$!
sleep 0.4
docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -c "SET lock_timeout='5s'; INSERT INTO ai_platform.ai_coding_bridge_responses(id,command_id,kind,created_at,acknowledged_at) VALUES('70c61ea0-8524-4fba-9da5-a88b2467a6a7','169a7492-cfd8-4a56-bb57-18001b6b5968','FAILED',now(),NULL);" > "$DIR/response-after-audit.out" 2>&1 &
RESP4=$!
wait "$AUDITOR4"
wait "$RESP4"
state="$(docker exec "$NAME" psql -U postgres -qAt -c "SELECT (SELECT count(*) FROM ai_platform.dev_gpt02_operator_review_intents),(SELECT count(*) FROM ai_platform.ai_coding_bridge_responses WHERE kind='FAILED');")"
if [[ "$state" != '1|1' ]];then
 echo "FAIL: audit-first/terminal-response-later history unexpected: $state"
 cat "$DIR/audit-before-new-response.out" "$DIR/response-after-audit.out"
 exit 1
fi
echo "PASS: audit committed first, then terminal response appended; 1 immutable historical audit (never a grant)"
# Mutable command response evidence after audit: do not mistake an immutable
# historical signed REVIEW INTENT for a currently valid checkpoint/BLOCKER.
# This exercise is synthetic in disposable PostgreSQL; real grant path is absent.
docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -c "
 UPDATE ai_platform.ai_coding_bridge_responses
 SET kind='FAILED'
 WHERE id='08b7b237-7a16-46d0-b79d-029d0363c112'::uuid;
 UPDATE ai_platform.ai_coding_bridge_responses
 SET acknowledged_at=NULL
 WHERE id='822efca2-7428-428a-ac66-548c0462438e'::uuid;
" > "$DIR/mutate-evidence.out" 2>&1
state="$(docker exec "$NAME" psql -U postgres -qAt -c "
 SELECT (SELECT count(*) FROM ai_platform.dev_gpt02_operator_review_intents),
        (SELECT count(*) FROM ai_platform.ai_coding_bridge_responses WHERE kind='BLOCKER'),
        (SELECT count(*) FROM ai_platform.ai_coding_bridge_responses WHERE kind='CHECKPOINT' AND acknowledged_at IS NOT NULL),
        (SELECT count(*) FROM ai_platform.ai_coding_bridge_responses WHERE kind='FAILED');")"
if [[ "$state" != '1|0|0|2' ]];then
 echo "FAIL: mutated evidence does not match expected state: $state";exit 1
fi
# Current-evidence eligibility is denied despite one immutable audit row.
eligible="$(docker exec "$NAME" psql -U postgres -qAt -c "
 SELECT EXISTS (
   SELECT 1 FROM ai_platform.dev_gpt02_operator_review_intents a
   JOIN ai_platform.ai_coding_bridge_commands c ON c.id=a.command_id
   JOIN ai_platform.ai_coding_bridge_responses cp ON cp.id=a.checkpoint_response_id
     AND cp.command_id=c.id AND cp.kind='CHECKPOINT'
     AND cp.acknowledged_at IS NOT NULL
   JOIN ai_platform.ai_coding_bridge_responses bl ON bl.id=a.blocker_response_id
     AND bl.command_id=c.id AND bl.kind='BLOCKER'
   WHERE c.status='PROCESSING'
     AND bl.id=(SELECT r.id FROM ai_platform.ai_coding_bridge_responses r
       WHERE r.command_id=c.id ORDER BY r.created_at DESC,r.id DESC LIMIT 1)
     AND NOT EXISTS(SELECT 1 FROM ai_platform.ai_coding_bridge_responses t
       WHERE t.command_id=c.id AND t.kind IN ('FAILED','COMPLETED'))
 );")"
if [[ "$eligible" != f ]];then
 echo "FAIL: current evidence incorrectly accepted a stale historical audit";exit 1
fi
echo "PASS: altered BLOCKER/ACK after review => historical audit stays, current evidence rejects resume"
echo "NOT tested: signed native ACK, authenticated operator session, actual grant/worker dispatch"
