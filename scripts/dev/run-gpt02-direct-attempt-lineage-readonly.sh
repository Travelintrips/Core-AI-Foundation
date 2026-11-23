#!/usr/bin/env bash
# Read-only direct GPT02 task/attempt/command inventory from two DEV apps.
# Does NOT establish independent cryptographic provenance or authorize resume.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TASK_ID="${1:-135}"
COMMAND_ID="${2:-83db99f5-cbda-4e60-be71-3090fb411bbb}"
[[ "$TASK_ID" =~ ^[1-9][0-9]{0,8}$ ]] || { echo INVALID_TASK_ID >&2; exit 2; }
[[ "$COMMAND_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] || { echo INVALID_COMMAND_ID >&2; exit 2; }
A="$(mktemp)"; B="$(mktemp)"; INPUT="$(mktemp)"
chmod 600 "$A" "$B" "$INPUT"
trap 'rm -f "$A" "$B" "$INPUT"' EXIT
# Each container uses a read-only transaction with bounded timeout. No raw
# instructions, messages, token, customer or signature payload is selected.
docker exec -i -w /app -e "AUDIT_COMMAND_ID=$COMMAND_ID" core-ai-dev node - <<'JS' > "$A"
const {Client}=require('/app/node_modules/.pnpm/pg@8.22.0/node_modules/pg');
(async()=>{
 const c=new Client({connectionString:process.env.SUPABASE_DEV_DATABASE_URL,connectionTimeoutMillis:5000,statement_timeout:7000});
 try{
  await c.connect();await c.query('BEGIN READ ONLY');
  const q=await c.query(`SELECT id::text,task_id::text,status
    FROM ai_platform.ai_coding_bridge_commands WHERE id=$1::uuid LIMIT 1`,[process.env.AUDIT_COMMAND_ID]);
  const p=await c.query(`SELECT
   to_regclass('ai_platform.dev_gpt02_task_attempt_binding_claims') IS NOT NULL AS binding_table_present,
   to_regclass('ai_platform.dev_gpt02_binding_attestation_nonces') IS NOT NULL AS nonce_table_present`);
  await c.query('ROLLBACK');
  console.log(JSON.stringify({command:q.rows[0]??null,...p.rows[0]}));
 }catch(e){console.error('CORE_READ_ONLY_FAILURE:'+String(e.code??'UNAVAILABLE'));process.exitCode=2;try{await c.query('ROLLBACK')}catch{}}
 finally{await c.end().catch(()=>{})}
})()
JS
docker exec -i -w /app/artifacts/api-server -e "AUDIT_TASK_ID=$TASK_ID" ai-task-development node - <<'JS' > "$B"
const {Client}=require('pg');
(async()=>{
 const c=new Client({connectionString:process.env.SUPABASE_DATABASE_URL_DEV,connectionTimeoutMillis:5000,statement_timeout:7000});
 try{
  await c.connect();await c.query('BEGIN READ ONLY');
  const q=await c.query(`SELECT j.id::text,j.task_id,j.company_id,j.source,j.status,
    j.command_id::text,j.attestation_verified,j.final_ack_verified,t.assigned_to_id
    FROM public.ai_execution_jobs j
    LEFT JOIN public.ai_tasks t ON t.id=j.task_id AND t.company_id=j.company_id
    WHERE j.task_id=$1::integer AND j.company_id='default' AND j.source='AI_TASK'
    ORDER BY j.created_at DESC,j.id DESC LIMIT 1`,[process.env.AUDIT_TASK_ID]);
  const p=await c.query(`SELECT
   to_regclass('ai_platform.dev_gpt02_task_attempt_binding_claims') IS NOT NULL AS binding_table_present,
   to_regclass('ai_platform.dev_gpt02_binding_attestation_nonces') IS NOT NULL AS nonce_table_present`);
  await c.query('ROLLBACK');
  console.log(JSON.stringify({execution:q.rows[0]??null,...p.rows[0]}));
 }catch(e){console.error('HUB_READ_ONLY_FAILURE:'+String(e.code??'UNAVAILABLE'));process.exitCode=2;try{await c.query('ROLLBACK')}catch{}}
 finally{await c.end().catch(()=>{})}
})()
JS
node - "$A" "$B" "$TASK_ID" "$COMMAND_ID" <<'JS' > "$INPUT"
const fs=require('node:fs');
const [a,b,t,c]=process.argv.slice(2);
process.stdout.write(JSON.stringify({taskId:Number(t),commandId:c,
 core:JSON.parse(fs.readFileSync(a,'utf8')),hub:JSON.parse(fs.readFileSync(b,'utf8'))})+'\n');
JS
node "$ROOT/scripts/dev/gpt02-direct-attempt-lineage-readonly.mjs" < "$INPUT"
