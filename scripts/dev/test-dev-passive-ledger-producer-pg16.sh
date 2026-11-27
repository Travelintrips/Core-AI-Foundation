#!/usr/bin/env bash
# Source selection only. Synthetic DB, no published port or external network.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
tmp="$(mktemp -d)"
name="dev-passive-ledger-producer-pg16-$$"
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT
docker run --rm -d --network none --name "$name" -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
ready=false
for i in $(seq 1 45); do
 if docker exec "$name" env PGCONNECT_TIMEOUT=2 psql -X -h 127.0.0.1 -U postgres -d postgres -Atqc 'SELECT 1' 2>/dev/null | grep -qx 1; then ready=true; break; fi
 sleep 1
done
test "$ready" = true
python3 - "$root" "$tmp/fixture.sql" <<'PY'
from pathlib import Path
import sys
root,out=map(Path,sys.argv[1:])
src=(root/'artifacts/api-server/src/services/devPassiveLedgerReconciliationScope.ts').read_text()
query=src.split('export const DEV_PASSIVE_PING_SOURCE_SQL = '+chr(96),1)[1].split(chr(96)+';',1)[0]
assert query.startswith('SELECT c.id, c.created_at, c.updated_at')
id='11111111-1111-4111-8111-111111111111'
other='22222222-2222-4222-8222-222222222222'
sql=r"""
\set ON_ERROR_STOP on
CREATE SCHEMA ai_platform;
CREATE TABLE ai_platform.ai_coding_bridge_commands(
 id uuid PRIMARY KEY, source text NOT NULL, command_type text NOT NULL, task_id uuid,
 instruction text NOT NULL, status text NOT NULL, metadata_json jsonb NOT NULL,
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL);
CREATE TABLE ai_platform.ai_coding_bridge_responses(
 id uuid PRIMARY KEY, command_id uuid, task_id uuid, kind text, message text,
 acknowledged_at timestamptz, metadata_json jsonb, checkpoint_json jsonb);
INSERT INTO ai_platform.ai_coding_bridge_commands VALUES(
 '11111111-1111-4111-8111-111111111111','ai-task-hub','EXTERNAL_AGENT_WORK',NULL,'ping','COMPLETED',
 '{"environment":"development","productionAllowed":false,"origin":"ai-task-hub","executionBoundary":"role-scoped","requiredCapability":"tools:bounded","criticalActionsRequireAiCoreApproval":true,"explicitWorkerTarget":true,"assignedClientId":"openclaw-pc-worker-dev","claimedBy":"openclaw-pc-worker-dev","completedBy":"openclaw-pc-worker-dev","statusCode":"JOB_COMPLETED","deliveryCode":"UNKNOWN_UNVERIFIED","e2eCode":"UNKNOWN_UNVERIFIED"}',
 '2026-11-28T01:00:00Z','2026-11-28T01:00:01Z');
INSERT INTO ai_platform.ai_coding_bridge_responses VALUES(
 '33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',NULL,'COMPLETED','pong from DELL','2026-11-28T01:00:02Z',
 '{"mode":"ping","runtime":"openclaw-pc2","statusCode":"JOB_COMPLETED","deliveryCode":"UNKNOWN_UNVERIFIED","e2eCode":"UNKNOWN_UNVERIFIED"}',
 '{"clientId":"openclaw-pc-worker-dev"}');
"""
bs=chr(92)
def check(label,expected,mutation=None,offset=0,limit=8):
 global sql
 actual=query.replace('$1',"'2026-11-27T19:08:02.868Z'").replace('$2',str(limit)).replace('$3',str(offset))
 sql+="BEGIN;\n"
 if mutation:sql+=mutation+";\n"
 sql+="WITH actual AS ("+actual+") SELECT count(*)="+str(expected)+" AS pass FROM actual "+bs+"gset\n"
 sql+=bs+"if :pass\n"+bs+"echo PASS "+label+"\n"+bs+"else\n"+bs+"echo FAIL "+label+"\n"+bs+"endif\nROLLBACK;\n"
check('eligible_future_acknowledged_ping',1)
check('historical_cutoff',0,"UPDATE ai_platform.ai_coding_bridge_commands SET created_at='2026-11-27T19:08:02.867Z'")
check('missing_source_ack',0,"UPDATE ai_platform.ai_coding_bridge_responses SET acknowledged_at=NULL")
check('duplicate_terminal',0,"INSERT INTO ai_platform.ai_coding_bridge_responses SELECT gen_random_uuid(),command_id,task_id,kind,message,acknowledged_at,metadata_json,checkpoint_json FROM ai_platform.ai_coding_bridge_responses")
check('unrelated_source',0,"UPDATE ai_platform.ai_coding_bridge_commands SET source='ai-core'")
check('wrong_worker',0,"UPDATE ai_platform.ai_coding_bridge_commands SET metadata_json=metadata_json||'{\"completedBy\":\"other\"}'")
check('wrong_pong',0,"UPDATE ai_platform.ai_coding_bridge_responses SET message='pong from other'")
check('protected_metadata',0,"UPDATE ai_platform.ai_coding_bridge_commands SET metadata_json=metadata_json||'{\"wakeBinding\":{}}'")
check('unknown_metadata',0,"UPDATE ai_platform.ai_coding_bridge_commands SET metadata_json=metadata_json||'{\"newField\":true}'")
check('handshake',0,"UPDATE ai_platform.ai_coding_bridge_commands SET command_type='HANDSHAKE_CONTINUE'")
check('linked_task',0,"UPDATE ai_platform.ai_coding_bridge_commands SET task_id=gen_random_uuid()")
check('failed',0,"UPDATE ai_platform.ai_coding_bridge_commands SET status='FAILED'")
check('malformed_metadata',0,"UPDATE ai_platform.ai_coding_bridge_commands SET metadata_json='[]'")
check('model_claim_not_promoted',0,"UPDATE ai_platform.ai_coding_bridge_responses SET metadata_json=metadata_json||'{\"e2eCode\":\"E2E_VERIFIED\"}'")
check('no_terminal',0,"UPDATE ai_platform.ai_coding_bridge_responses SET kind='ACK'")
both="INSERT INTO ai_platform.ai_coding_bridge_commands SELECT '"+other+"',source,command_type,task_id,instruction,status,metadata_json,created_at+interval '1 second',updated_at FROM ai_platform.ai_coding_bridge_commands WHERE id='"+id+"'; INSERT INTO ai_platform.ai_coding_bridge_responses SELECT gen_random_uuid(),'"+other+"',task_id,kind,message,acknowledged_at,metadata_json,checkpoint_json FROM ai_platform.ai_coding_bridge_responses WHERE command_id='"+id+"'"
check('bounded_limit',1,both,limit=1)
check('bounded_offset',1,both,offset=1,limit=1)
check('bounded_end',0,both,offset=2,limit=1)
out.write_text(sql)
PY
docker exec -i "$name" env PGCONNECT_TIMEOUT=2 psql -X -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 < "$tmp/fixture.sql" | tee "$tmp/result"
test "$(grep -c '^PASS ' "$tmp/result")" -eq 18
! grep -q '^FAIL ' "$tmp/result"
echo 'PROSPECTIVE_SOURCE_SQL=18/18_PASS'
