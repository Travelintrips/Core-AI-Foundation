#!/usr/bin/env bash
# Exact SQL proposal safety test, using a throwaway network-isolated PostgreSQL.
# NEVER deploys the proposal or creates actual command/grant/lease records.
set -euo pipefail
NAME="gpt02-inert-claim-$$"
DIR="$(mktemp -d /tmp/gpt02-inert.XXXXXX)"
cleanup(){ docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
docker run -d --name "$NAME" --network none --tmpfs /var/lib/postgresql/data:rw,size=256m --shm-size=64m -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
for i in $(seq 1 40); do
 if docker exec "$NAME" pg_isready -q -U postgres; then
  sleep 2
  if docker exec "$NAME" psql -U postgres -qAt -c "SELECT 1" 2>/dev/null | grep -qx 1;then break; fi
 fi
 sleep 1
done
docker exec "$NAME" psql -U postgres -qAt -c "SELECT 1" | grep -qx 1
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE SCHEMA ai_platform;
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
CREATE TABLE ai_platform.ai_coding_bridge_commands(id uuid PRIMARY KEY);
CREATE TABLE ai_platform.internal_users(id integer PRIMARY KEY);
INSERT INTO ai_platform.internal_users VALUES(7);
CREATE TABLE ai_platform.ai_coding_bridge_responses(
 id uuid PRIMARY KEY,command_id uuid REFERENCES ai_platform.ai_coding_bridge_commands(id));
INSERT INTO ai_platform.ai_coding_bridge_commands VALUES
 ('169a7492-cfd8-4a56-bb57-18001b6b5968');
INSERT INTO ai_platform.ai_coding_bridge_responses VALUES
 ('822efca2-7428-428a-ac66-548c0462438e','169a7492-cfd8-4a56-bb57-18001b6b5968'),
 ('08b7b237-7a16-46d0-b79d-029d0363c112','169a7492-cfd8-4a56-bb57-18001b6b5968');
SQL
# Exact review-intent schema first: proposal requires a matching signed review
# row. All proof bytes and identities in this test are synthetic, not trusted.
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q < docs/dev/gpt02-operator-review-intents.storage.sql
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
INSERT INTO ai_platform.dev_gpt02_operator_review_intents
(id,command_id,checkpoint_response_id,blocker_response_id,operator_user_id,
 operator_role,worker_id,nonce,proof_json,signed_at,expires_at)
VALUES(
'2e14f3e6-c7b0-41f5-81b8-1c5ff5cd4dc0',
'169a7492-cfd8-4a56-bb57-18001b6b5968',
'822efca2-7428-428a-ac66-548c0462438e',
'08b7b237-7a16-46d0-b79d-029d0363c112',
7,'admin','openclaw-dell-chatgpt-wake-dev',
'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
'{"version":1,"action":"gpt02.resume.grant.review","commandId":"169a7492-cfd8-4a56-bb57-18001b6b5968","checkpointResponseId":"822efca2-7428-428a-ac66-548c0462438e","blockerResponseId":"08b7b237-7a16-46d0-b79d-029d0363c112","workerId":"openclaw-dell-chatgpt-wake-dev","operatorId":"internal:7","operatorRole":"admin","nonce":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","issuedAt":"2026-11-08T00:00:00.000Z","expiresAt":"2026-11-08T00:01:30.000Z","signatureBase64":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=="}'::jsonb,
clock_timestamp()-interval '2 seconds',clock_timestamp()+interval '90 seconds');
SQL
# Execute exact checked-in proposal (no copied/reimplemented function).
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q < docs/dev/gpt02-atomic-resume-claim.proposed.sql
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
-- Keep fixture TTL below 120s: separate clock_timestamp() evaluations are not identical.
INSERT INTO ai_platform.dev_gpt02_resume_grants
(command_id,review_intent_id,operator_user_id,checkpoint_response_id,blocker_response_id,worker_id,status,approved_by,approved_at,expires_at)
VALUES('169a7492-cfd8-4a56-bb57-18001b6b5968','2e14f3e6-c7b0-41f5-81b8-1c5ff5cd4dc0',7,
'822efca2-7428-428a-ac66-548c0462438e','08b7b237-7a16-46d0-b79d-029d0363c112',
'openclaw-dell-chatgpt-wake-dev','APPROVED','internal:7',clock_timestamp(),
clock_timestamp()+interval '90 seconds');
SQL
# Missing review must fail, and an unrelated response/worker must not
# satisfy the composite FK even with a valid review ID.
for mismatch in no_review wrong_worker; do
 if [[ "$mismatch" == no_review ]]; then
   sql="INSERT INTO ai_platform.dev_gpt02_resume_grants(command_id,checkpoint_response_id,blocker_response_id,worker_id,status,approved_by,approved_at,expires_at) VALUES('169a7492-cfd8-4a56-bb57-18001b6b5968','822efca2-7428-428a-ac66-548c0462438e','08b7b237-7a16-46d0-b79d-029d0363c112','openclaw-dell-chatgpt-wake-dev','APPROVED','internal:7',now(),now()+interval '90 seconds');"
 else
   sql="INSERT INTO ai_platform.dev_gpt02_resume_grants(command_id,review_intent_id,operator_user_id,checkpoint_response_id,blocker_response_id,worker_id,status,approved_by,approved_at,expires_at) VALUES('169a7492-cfd8-4a56-bb57-18001b6b5968','2e14f3e6-c7b0-41f5-81b8-1c5ff5cd4dc0',7,'822efca2-7428-428a-ac66-548c0462438e','08b7b237-7a16-46d0-b79d-029d0363c112','other-worker','APPROVED','internal:7',now(),now()+interval '90 seconds');"
 fi
 if docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -c "$sql" > "$DIR/$mismatch" 2>&1;then
  echo "NO-GO: grant accepted $mismatch";exit 1
 fi
done
echo 'PASS: missing review ID and mismatched review identity both denied'
# A privileged SQL caller must not invent a different human approver,
# nor backdate approval / create an excessively long-lived grant.
for case in bad_approver long_ttl old_approval null_consumed_approver;do
 if [[ "$case" == bad_approver ]];then
  query="UPDATE ai_platform.dev_gpt02_resume_grants SET approved_by='internal:8';"
 elif [[ "$case" == long_ttl ]];then
  query="UPDATE ai_platform.dev_gpt02_resume_grants SET expires_at=approved_at + interval '10 minutes';"
 elif [[ "$case" == old_approval ]];then
  query="UPDATE ai_platform.dev_gpt02_resume_grants SET approved_at=created_at - interval '1 day';"
 else
  query="UPDATE ai_platform.dev_gpt02_resume_grants SET status='CONSUMED',consumed_at=clock_timestamp(),approved_by=NULL;"
 fi
 if docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -c "$query" > "$DIR/$case" 2>&1;then
  echo "NO-GO: unsafe grant UPDATE allowed $case";exit 1
 fi
done
echo 'PASS: wrong approver identity, excessive TTL, backdated approval and NULL consumed approver all denied'

GRANT_ID="$(docker exec "$NAME" psql -U postgres -qAt -c 'SELECT id FROM ai_platform.dev_gpt02_resume_grants LIMIT 1')"
if docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -c "SELECT * FROM ai_platform.dev_gpt02_claim_resume('$GRANT_ID'::uuid,'169a7492-cfd8-4a56-bb57-18001b6b5968'::uuid,'08b7b237-7a16-46d0-b79d-029d0363c112'::uuid,'822efca2-7428-428a-ac66-548c0462438e'::uuid,'openclaw-dell-chatgpt-wake-dev',90);" > "$DIR/err" 2>&1;then
 echo 'NO-GO: inert claim returned successfully';exit 1
fi
grep -F 'RESUME_DISPATCH_GUARD_NOT_IMPLEMENTED' "$DIR/err" >/dev/null || { cat "$DIR/err";exit 1; }
rows="$(docker exec "$NAME" psql -U postgres -qAt -c "SELECT (SELECT COUNT(*) FROM ai_platform.dev_gpt02_resume_grants WHERE status='APPROVED' AND consumed_at IS NULL),(SELECT COUNT(*) FROM ai_platform.dev_gpt02_resume_command_leases),has_function_privilege('anon','ai_platform.dev_gpt02_claim_resume(uuid,uuid,uuid,uuid,text,integer)','EXECUTE'),has_function_privilege('authenticated','ai_platform.dev_gpt02_claim_resume(uuid,uuid,uuid,uuid,text,integer)','EXECUTE');")"
[[ "$rows" == '1|0|f|f' ]] || { echo "NO-GO: unexpected readback $rows";exit 1; }
echo 'PASS: exact proposed claim is inert (0A000 guard); approved synthetic grant unconsumed; no lease; no anon/authenticated EXECUTE'


# Replay protection survives a grant's REVOKED status. One review must never
# back a second grant, even when the one-live-per-command index no longer applies.
docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -c "UPDATE ai_platform.dev_gpt02_resume_grants SET status='REVOKED';" > "$DIR/revoked" 2>&1
if docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -c "INSERT INTO ai_platform.dev_gpt02_resume_grants(command_id,review_intent_id,operator_user_id,checkpoint_response_id,blocker_response_id,worker_id,status,approved_by,approved_at,expires_at) VALUES('169a7492-cfd8-4a56-bb57-18001b6b5968','2e14f3e6-c7b0-41f5-81b8-1c5ff5cd4dc0',7,'822efca2-7428-428a-ac66-548c0462438e','08b7b237-7a16-46d0-b79d-029d0363c112','openclaw-dell-chatgpt-wake-dev','APPROVED','internal:7',now(),now()+interval '90 seconds');" > "$DIR/replay" 2>&1;then
 echo 'NO-GO: same review reused after revoked grant';exit 1
fi
grep -F 'dev_gpt02_grants_review_one_time' "$DIR/replay" >/dev/null || { echo 'NO-GO: replay rejected for unexpected reason';cat "$DIR/replay";exit 1; }
echo 'PASS: one review cannot mint second grant after first is revoked'
# A revoked grant is permanent, not a re-approvable row.
for bad in "UPDATE ai_platform.dev_gpt02_resume_grants SET status='APPROVED';" "DELETE FROM ai_platform.dev_gpt02_resume_grants;"; do
 if docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -c "$bad" > "$DIR/resurrection" 2>&1;then
  echo "NO-GO: terminal grant resurrection or DELETE permitted";exit 1
 fi
 grep -E 'GPT02_GRANT_(TERMINAL_IMMUTABLE|DELETE_FORBIDDEN)' "$DIR/resurrection" >/dev/null || {
  echo "NO-GO: terminal protection denied for unexpected reason";cat "$DIR/resurrection";exit 1;
 }
done
echo 'PASS: revoked grant cannot be restored or deleted'
# A PENDING grant may be cancelled, but cannot be promoted to APPROVED
# via direct DML while the authenticated issuance path does not exist.
docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -c "INSERT INTO ai_platform.dev_gpt02_resume_grants(command_id,checkpoint_response_id,blocker_response_id,worker_id,status,expires_at) VALUES('169a7492-cfd8-4a56-bb57-18001b6b5968','822efca2-7428-428a-ac66-548c0462438e','08b7b237-7a16-46d0-b79d-029d0363c112','openclaw-dell-chatgpt-wake-dev','PENDING',clock_timestamp()+interval '90 seconds');" > "$DIR/pending" 2>&1
for case in pending_to_approved pending_identity_mutation;do
 if [[ "$case" == pending_to_approved ]];then
  statement="UPDATE ai_platform.dev_gpt02_resume_grants SET status='APPROVED',review_intent_id='2e14f3e6-c7b0-41f5-81b8-1c5ff5cd4dc0',operator_user_id=7,approved_by='internal:7',approved_at=clock_timestamp() WHERE status='PENDING';"
  reason='GPT02_GRANT_PENDING_PROMOTION_DISABLED'
 else
  statement="UPDATE ai_platform.dev_gpt02_resume_grants SET worker_id='other-worker',status='REVOKED' WHERE status='PENDING';"
  reason='GPT02_GRANT_BINDING_IMMUTABLE'
 fi
 if docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -c "$statement" > "$DIR/$case" 2>&1;then
  echo "NO-GO: unsafe PENDING grant transition permitted $case";exit 1
 fi
 grep -F "$reason" "$DIR/$case" >/dev/null || {
  echo "NO-GO: unexpected PENDING grant denial reason ($case)";cat "$DIR/$case";exit 1;
 }
done
docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -c "UPDATE ai_platform.dev_gpt02_resume_grants SET status='REVOKED' WHERE status='PENDING';" > "$DIR/pending_revoke" 2>&1
pstate="$(docker exec "$NAME" psql -U postgres -qAt -c "SELECT COUNT(*) FROM ai_platform.dev_gpt02_resume_grants WHERE status='REVOKED';")"
[[ "$pstate" == 2 ]] || { echo "NO-GO: pending revoke state $pstate";exit 1; }
echo 'PASS: PENDING grant cannot self-approve or alter identity; safe revoke remains allowed'
# Three independent concurrent connections race to mint from the SAME review.
# Reset ONLY the disposable synthetic fixture using TRUNCATE. This is superuser
# test setup, never an application API operation; row-level DELETE is guarded.
docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -c 'TRUNCATE ai_platform.dev_gpt02_resume_grants CASCADE;' > "$DIR/clear" 2>&1
race_sql="INSERT INTO ai_platform.dev_gpt02_resume_grants(command_id,review_intent_id,operator_user_id,checkpoint_response_id,blocker_response_id,worker_id,status,approved_by,approved_at,expires_at) VALUES('169a7492-cfd8-4a56-bb57-18001b6b5968','2e14f3e6-c7b0-41f5-81b8-1c5ff5cd4dc0',7,'822efca2-7428-428a-ac66-548c0462438e','08b7b237-7a16-46d0-b79d-029d0363c112','openclaw-dell-chatgpt-wake-dev','APPROVED','internal:7',clock_timestamp(),clock_timestamp()+interval '90 seconds');"
for i in 1 2 3; do
 (
  if docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -c "$race_sql" > "$DIR/race$i.out" 2>&1;then
   echo success > "$DIR/race$i.status"
  else
   echo denied > "$DIR/race$i.status"
  fi
 ) &
done
wait
winners="$(grep -l '^success$' "$DIR"/race*.status | wc -l)"
denied="$(grep -l '^denied$' "$DIR"/race*.status | wc -l)"
# Two unique indexes can arbitrate competing inserts: same review lifetime
# or same active command. Either exact uniqueness conflict is acceptable;
# connection errors or unrelated CHECK failures are NOT acceptable.
for i in 1 2 3; do
 if [[ "$(cat "$DIR/race$i.status")" == denied ]];then
  if ! grep -F 'dev_gpt02_grants_review_one_time' "$DIR/race$i.out" >/dev/null &&
     ! grep -F 'dev_gpt02_resume_grants_one_live_per_command' "$DIR/race$i.out" >/dev/null;then
    echo "NO-GO: concurrent grant rejected for unexpected reason ($i)"
    cat "$DIR/race$i.out";exit 1
  fi
 fi
done
state="$(docker exec "$NAME" psql -U postgres -qAt -c "SELECT (SELECT count(*) FROM ai_platform.dev_gpt02_resume_grants),(SELECT count(*) FROM ai_platform.dev_gpt02_resume_command_leases);")"
if [[ "$winners" -ne 1 || "$denied" -ne 2 || "$state" != '1|0' ]];then
 echo "NO-GO: review race winners=$winners denied=$denied state=$state"
 cat "$DIR"/race*.out;exit 1
fi
echo 'PASS: three concurrent reviewers using one synthetic review => exactly one grant, two rejected, no lease'
