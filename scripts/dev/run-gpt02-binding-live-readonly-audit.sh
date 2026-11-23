#!/usr/bin/env bash
# Authorized VPS DEV audit only. Does not install DDL, issue grants or dispatch.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
COMMAND_ID="${1:-c43000bf-c952-4e91-9344-02d9256f9768}"
[[ "$COMMAND_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] || { echo 'INVALID_COMMAND_ID' >&2; exit 2; }
command -v docker >/dev/null && command -v node >/dev/null
A=$(mktemp); B=$(mktemp); OUT=$(mktemp)
chmod 600 "$A" "$B" "$OUT"
trap 'rm -f "$A" "$B" "$OUT"' EXIT
# Sources are two different authorized DEV containers. Each opens a database
# transaction in READ ONLY mode. Only non-sensitive bounded columns are emitted.
docker exec -i -w /app -e "GPT02_AUDIT_COMMAND_ID=$COMMAND_ID" core-ai-dev node - <<'JS' > "$A"
const {Client}=require('/app/node_modules/.pnpm/pg@8.22.0/node_modules/pg');
(async()=>{const c=new Client({connectionString:process.env.SUPABASE_DEV_DATABASE_URL,connectionTimeoutMillis:6000,statement_timeout:7000});try{await c.connect();await c.query('BEGIN READ ONLY');const row=await c.query('SELECT id::text,task_id::text,status FROM ai_platform.ai_coding_bridge_commands WHERE id=$1::uuid',[process.env.GPT02_AUDIT_COMMAND_ID]);const q=await c.query("SELECT to_regclass('ai_platform.dev_gpt02_task_attempt_binding_claims')::text AS binding,to_regclass('ai_platform.dev_gpt02_binding_attestation_nonces')::text AS nonce");await c.query('COMMIT');console.log(JSON.stringify({system:'AI_CORE_DEV',command:row.rows[0]??null,proposedTables:q.rows[0]}));}catch(e){console.error('CORE_READ_ONLY_AUDIT_FAILURE:'+String(e.code||'UNKNOWN'));process.exitCode=2;try{await c.query('ROLLBACK')}catch{}}finally{await c.end().catch(()=>{})}})()
JS
docker exec -i -w /app/artifacts/api-server -e "GPT02_AUDIT_COMMAND_ID=$COMMAND_ID" ai-task-development node - <<'JS' > "$B"
const {Client}=require('pg');
(async()=>{const c=new Client({connectionString:process.env.SUPABASE_DATABASE_URL_DEV,connectionTimeoutMillis:6000,statement_timeout:7000});try{await c.connect();await c.query('BEGIN READ ONLY');const row=await c.query('SELECT external_id,task_id,status,progress FROM public.ai_execution_jobs WHERE external_id=$1',['bridge-command:'+process.env.GPT02_AUDIT_COMMAND_ID]);const q=await c.query("SELECT to_regclass('ai_platform.dev_gpt02_task_attempt_binding_claims')::text AS binding,to_regclass('ai_platform.dev_gpt02_binding_attestation_nonces')::text AS nonce");await c.query('COMMIT');console.log(JSON.stringify({system:'AI_TASK_DEV',receiver:row.rows[0]??null,proposedTables:q.rows[0]}));}catch(e){console.error('RECEIVER_READ_ONLY_AUDIT_FAILURE:'+String(e.code||'UNKNOWN'));process.exitCode=2;try{await c.query('ROLLBACK')}catch{}}finally{await c.end().catch(()=>{})}})()
JS
node - "$A" "$B" "$COMMAND_ID" <<'JS' > "$OUT"
const fs=require('fs');const [a,b,id]=process.argv.slice(2);const source=JSON.parse(fs.readFileSync(a,'utf8'));const receiver=JSON.parse(fs.readFileSync(b,'utf8'));process.stdout.write(JSON.stringify({source,receiver,commandId:id})+'\n');
JS
node "$ROOT/scripts/dev/gpt02-binding-live-readonly-audit.mjs" < "$OUT"
