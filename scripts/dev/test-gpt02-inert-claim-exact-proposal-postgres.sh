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
CREATE TABLE ai_platform.ai_coding_bridge_responses(
 id uuid PRIMARY KEY,command_id uuid REFERENCES ai_platform.ai_coding_bridge_commands(id));
INSERT INTO ai_platform.ai_coding_bridge_commands VALUES
 ('169a7492-cfd8-4a56-bb57-18001b6b5968');
INSERT INTO ai_platform.ai_coding_bridge_responses VALUES
 ('822efca2-7428-428a-ac66-548c0462438e','169a7492-cfd8-4a56-bb57-18001b6b5968'),
 ('08b7b237-7a16-46d0-b79d-029d0363c112','169a7492-cfd8-4a56-bb57-18001b6b5968');
SQL
# Execute exact checked-in proposal (no copied/reimplemented function).
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q < docs/dev/gpt02-atomic-resume-claim.proposed.sql
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
INSERT INTO ai_platform.dev_gpt02_resume_grants
(command_id,checkpoint_response_id,blocker_response_id,worker_id,status,approved_by,approved_at,expires_at)
VALUES('169a7492-cfd8-4a56-bb57-18001b6b5968',
'822efca2-7428-428a-ac66-548c0462438e','08b7b237-7a16-46d0-b79d-029d0363c112',
'openclaw-dell-chatgpt-wake-dev','APPROVED','synthetic-operator',clock_timestamp(),
clock_timestamp()+interval '2 minutes');
SQL
GRANT_ID="$(docker exec "$NAME" psql -U postgres -qAt -c 'SELECT id FROM ai_platform.dev_gpt02_resume_grants LIMIT 1')"
if docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -c "SELECT * FROM ai_platform.dev_gpt02_claim_resume('$GRANT_ID'::uuid,'169a7492-cfd8-4a56-bb57-18001b6b5968'::uuid,'08b7b237-7a16-46d0-b79d-029d0363c112'::uuid,'822efca2-7428-428a-ac66-548c0462438e'::uuid,'openclaw-dell-chatgpt-wake-dev',90);" > "$DIR/err" 2>&1;then
 echo 'NO-GO: inert claim returned successfully';exit 1
fi
grep -F 'RESUME_DISPATCH_GUARD_NOT_IMPLEMENTED' "$DIR/err" >/dev/null || { cat "$DIR/err";exit 1; }
rows="$(docker exec "$NAME" psql -U postgres -qAt -c "SELECT (SELECT COUNT(*) FROM ai_platform.dev_gpt02_resume_grants WHERE status='APPROVED' AND consumed_at IS NULL),(SELECT COUNT(*) FROM ai_platform.dev_gpt02_resume_command_leases),has_function_privilege('anon','ai_platform.dev_gpt02_claim_resume(uuid,uuid,uuid,uuid,text,integer)','EXECUTE'),has_function_privilege('authenticated','ai_platform.dev_gpt02_claim_resume(uuid,uuid,uuid,uuid,text,integer)','EXECUTE');")"
[[ "$rows" == '1|0|f|f' ]] || { echo "NO-GO: unexpected readback $rows";exit 1; }
echo 'PASS: exact proposed claim is inert (0A000 guard); approved synthetic grant unconsumed; no lease; no anon/authenticated EXECUTE'
