#!/usr/bin/env node
"use strict";
// Unified, bounded and READ ONLY. Never authorizes or resumes GPT02.
// Run on authorized DEV VPS with GPT02_UNIFIED_INVENTORY_MODE=DEV_VPS_READONLY.
const {spawnSync}=require("node:child_process");
const ID="83db99f5-cbda-4e60-be71-3090fb411bbb",TASK=135;
function inside(service,dir,pg,dsn,sql,param){
 const code=[
  'const {Client}=require('+JSON.stringify(pg)+');',
  '(async()=>{const c=new Client({connectionString:process.env['+JSON.stringify(dsn)+'],connectionTimeoutMillis:5000,statement_timeout:7000});',
  'try{await c.connect();await c.query("BEGIN READ ONLY");',
  'const v=await c.query('+JSON.stringify(sql)+',['+JSON.stringify(param)+']);',
  'await c.query("ROLLBACK");console.log(JSON.stringify(v.rows[0]||{}));',
  '}catch(e){try{await c.query("ROLLBACK")}catch{}console.error(String(e.code||"READ_FAIL"));process.exitCode=2}',
  'finally{await c.end().catch(()=>{})}})()'
 ].join('');
 const p=spawnSync('docker',['exec','-i','-w',dir,service,'node','-'],{input:code,encoding:'utf8',timeout:15000});
 if(p.status!==0)throw Error(service+'_READBACK_UNAVAILABLE:'+String(p.stderr).slice(-80));
 return JSON.parse(p.stdout.trim().split(/\r?\n/).at(-1));
}
function healthy(service){
 const p=spawnSync('docker',['inspect',service,'--format','{{.State.Health.Status}}'],{encoding:'utf8',timeout:5000});
 return p.status===0&&p.stdout.trim()==='healthy';
}
const coreSql="SELECT to_regclass('ai_platform.dev_gpt02_task_attempt_binding_claims') IS NOT NULL AS binding_ready, to_regclass('ai_platform.dev_gpt02_binding_attestation_nonces') IS NOT NULL AS nonce_ready, to_regclass('ai_platform.dev_gpt02_resume_grants') IS NOT NULL AS grant_ready, to_regclass('ai_platform.dev_gpt02_resume_command_leases') IS NOT NULL AS lease_ready, (SELECT status FROM ai_platform.ai_coding_bridge_commands WHERE id=$1::uuid) AS command_status, (SELECT task_id::text FROM ai_platform.ai_coding_bridge_commands WHERE id=$1::uuid) AS core_task_id";
const hubSql="SELECT current_user AS role, (SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb FROM pg_roles WHERE rolname=current_user) AS privileged, pg_has_role(current_user,'pg_read_all_data','MEMBER') AS global_reader, pg_has_role(current_user,'dev_gpt02_claim_writer_nologin','SET') AS can_set_writer, has_table_privilege(current_user,'ai_platform.dev_gpt02_task_attempt_binding_claims','INSERT,UPDATE,DELETE') AS can_mutate_claim, has_table_privilege(current_user,'ai_platform.dev_gpt02_binding_attestation_nonces','INSERT,UPDATE,DELETE') AS can_mutate_nonce, j.id::text AS execution_id, j.command_id::text AS command_id, j.status AS execution_status, j.attestation_verified, j.final_ack_verified, t.assigned_to_id IS NOT NULL AS pic_present FROM public.ai_tasks t LEFT JOIN LATERAL (SELECT id,command_id,status,attestation_verified,final_ack_verified FROM public.ai_execution_jobs WHERE task_id=t.id AND company_id=t.company_id AND source='AI_TASK' ORDER BY created_at DESC,id DESC LIMIT 1) j ON true WHERE t.id=$1 AND t.company_id='default' LIMIT 1";
function assess(c,h,services){
 const checks={
  coreDevHealthy:services.core,hubDevHealthy:services.hub,prodHealthy:services.prod,
  bindingStorage:c.binding_ready===true,nonceStorage:c.nonce_ready===true,
  directDmlFenced:h.can_mutate_claim===false&&h.can_mutate_nonce===false&&h.can_set_writer===false,
  restrictedHubDbLogin:h.role!=='postgres'&&h.privileged===false&&h.global_reader===false,
  grantSchema:c.grant_ready===true,commandLeaseSchema:c.lease_ready===true,
  picPresent:h.pic_present===true,commandReferenceMatch:h.command_id===ID,
  coreTaskLinked:Boolean(c.core_task_id),commandNotFailed:!!c.command_status&&c.command_status!=='FAILED',
  attestationRecorded:h.attestation_verified===true,nativeAckRecorded:h.final_ack_verified===true
 };
 const blockers=Object.entries(checks).filter(([,v])=>!v).map(([k])=>k);
 blockers.push('INDEPENDENT_NATIVE_PROVENANCE_NOT_ATTESTED','ISSUER_OPERATOR_GRANT_NOT_ATTESTED','DELL_NATIVE_ACK_NOT_ATTESTED');
 return {environment:'DEV',taskId:TASK,mode:'UNIFIED_READ_ONLY',checks,
  passed:Object.values(checks).filter(Boolean).length,total:Object.keys(checks).length+3,
  blockers,observations:{coreCommandStatus:c.command_status,coreTaskIdPresent:!!c.core_task_id,
   executionStatus:h.execution_status,executionObserved:!!h.execution_id,
   currentHubDbRole:h.role,bindingCountsNotRequested:true},
  releaseDecision:'NO_GO',issuerPermitted:false,dispatchPermitted:false,
  resumePermitted:false,completionPermitted:false,readOnly:true};
}
function main(){
 if(process.env.GPT02_UNIFIED_INVENTORY_MODE!=='DEV_VPS_READONLY'){
  console.error('DEV_VPS_READONLY_MODE_REQUIRED');process.exitCode=2;return;
 }
 try{
  const c=inside('core-ai-dev','/app','/app/node_modules/.pnpm/pg@8.22.0/node_modules/pg','SUPABASE_DEV_DATABASE_URL',coreSql,ID);
  const h=inside('ai-task-development','/app/artifacts/api-server','pg','SUPABASE_DATABASE_URL_DEV',hubSql,TASK);
  const report=assess(c,h,{core:healthy('core-ai-dev'),hub:healthy('ai-task-development'),prod:healthy('ai-core-prod-api')&&healthy('ai-task-production')});
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  process.exitCode=3; // Expected NO_GO until independently authorized E2E
 }catch(e){console.error('UNIFIED_READBACK_UNAVAILABLE:'+String(e.message).slice(0,130));process.exitCode=2}
}
module.exports={assess};
if(require.main===module)main();
