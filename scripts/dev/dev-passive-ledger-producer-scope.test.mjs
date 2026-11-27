import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveLedgerReconciliationScope, prospectiveLedgerSince, DEV_PASSIVE_PING_SOURCE_SQL } from "../../artifacts/api-server/src/services/devPassiveLedgerReconciliationScope.ts";
const project="xssrfshdrtdfupgqwfdw";
const cutoff="2026-11-27T19:08:02.868Z";
const env={NODE_ENV:"development",APP_ENV:"development",AI_TASK_LEDGER_URL:"https://dev-ai-task.cstlogistic.co.id",SUPABASE_URL_DEV:"https://"+project+".supabase.co",SUPABASE_DEV_DATABASE_URL:"postgresql://fixture."+project+":fixture@aws-1.pooler.supabase.com:6543/postgres",AI_TASK_DEV_PASSIVE_PING_SYNC_SINCE:cutoff};

test("new scope defaults to legacy, including existing PROD",()=>{
 assert.deepEqual(resolveLedgerReconciliationScope({}),{mode:"legacy"});
 assert.deepEqual(resolveLedgerReconciliationScope({NODE_ENV:"production"}),{mode:"legacy"});
});
test("strict DEV scope accepts explicit current cutoff and exact database identity",()=>{
 assert.deepEqual(resolveLedgerReconciliationScope(env),{mode:"dev-passive-ping",since:new Date(cutoff)});
 assert.equal(resolveLedgerReconciliationScope({...env,SUPABASE_DEV_DATABASE_URL:"postgresql://fixture:fixture@db."+project+".supabase.co/postgres"}).mode,"dev-passive-ping");
});
test("malformed opt-in, PROD, other hosts, other project and ambiguous settings fail closed",()=>{
 for(const patch of [{AI_TASK_DEV_PASSIVE_PING_SYNC_SINCE:""},{AI_TASK_DEV_PASSIVE_PING_SYNC_SINCE:"2026-11-27T17:54:14.000Z"},{AI_TASK_DEV_PASSIVE_PING_SYNC_SINCE:"2026-02-30T00:00:00.000Z"},{AI_TASK_DEV_PASSIVE_PING_SYNC_SINCE:"invalid"},{NODE_ENV:"production"},{APP_ENV:"production"},{AI_TASK_LEDGER_URL:"https://ai-task.cstlogistic.co.id"},{AI_TASK_LEDGER_URL:"https://dev-ai-task.cstlogistic.co.id/path"},{SUPABASE_URL_DEV:"https://other.supabase.co"},{SUPABASE_DEV_DATABASE_URL:"postgresql://fixture.other:fixture@aws-1.pooler.supabase.com/postgres"},{SUPABASE_DEV_DATABASE_URL:"postgresql://fixture."+project+":fixture@evil.example/postgres"},{SUPABASE_DATABASE_URL_DEV:"postgresql://other"},{VITE_SUPABASE_URL_DEV:"https://other.supabase.co"},{AI_TASK_DEV_PASSIVE_LEDGER_RECOVERY_COMMAND_ID:"another-mode"}]) {
  assert.equal(resolveLedgerReconciliationScope({...env,...patch}).mode,"blocked",JSON.stringify(patch));
 }
});
test("lookback never reaches before the explicit activation cutoff",()=>{
 const scope=resolveLedgerReconciliationScope(env);assert.equal(scope.mode,"dev-passive-ping");
 assert.equal(prospectiveLedgerSince(scope,new Date("2026-11-10T00:00:00Z")).toISOString(),cutoff);
 assert.equal(prospectiveLedgerSince(scope,new Date("2026-11-28T00:00:00Z")).toISOString(),"2026-11-28T00:00:00.000Z");
});
test("source SQL is bounded, read-only, terminal acknowledged ping and not a general reconciliation",()=>{
 for(const literal of ["c.source='ai-task-hub'","c.command_type='EXTERNAL_AGENT_WORK'","c.task_id IS NULL","c.created_at >= $1::timestamptz","c.instruction='ping'","c.status='COMPLETED'","'tools:bounded'","'openclaw-pc-worker-dev'","'UNKNOWN_UNVERIFIED'","jsonb_object_keys","'wakeBinding'","r.acknowledged_at IS NOT NULL","r.message='pong from DELL'","LIMIT $2 OFFSET $3"])assert.ok(DEV_PASSIVE_PING_SOURCE_SQL.includes(literal),literal);
 assert.doesNotMatch(DEV_PASSIVE_PING_SOURCE_SQL,/\b(?:INSERT|UPDATE|DELETE|ALTER|GRANT|FOR UPDATE)\b/i);
 assert.doesNotMatch(DEV_PASSIVE_PING_SOURCE_SQL,/ai_task_bridge\.|public\.|SELECT \*/);
 assert.match(DEV_PASSIVE_PING_SOURCE_SQL,/^SELECT c\.id, c\.created_at, c\.updated_at/);
});
test("scoped tick uses only the new bounded loader; no changes to transport, ACK or dispatch",()=>{
 const code=readFileSync(new URL("../../artifacts/api-server/src/services/aiTaskLedgerReconciliationService.ts",import.meta.url),"utf8");
 assert.match(code,/if \(scope\.mode === "blocked"\) return empty/);
 assert.match(code,/if \(scope\.mode === "dev-passive-ping"\) \{[\s\S]*?loadScoped\(scopedPageOffset, earliest\)[\s\S]*?\} else if \(customLoad\)/);
 assert.match(code,/DEV_PASSIVE_PING_SOURCE_SQL, \[since\.toISOString\(\), PAGE_SIZE, offset\]/);
 assert.match(code,/receipt\.acknowledged === true/);
 assert.doesNotMatch(code,/submitAiTaskCommand|dispatchExternalAgentWork|executeWorker/);
});
