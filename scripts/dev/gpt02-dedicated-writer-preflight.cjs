"use strict";
/**
 * DEV-only, read-only dedicated writer connection preflight.
 * This module never writes a claim, nonce, grant, lease or command.
 *
 * GPT02_BINDING_WRITER_DATABASE_URL_DEV must belong to a distinct, actual
 * PostgreSQL LOGIN with INSERT-only access to the proposed claim+nonce tables.
 * It MUST NOT be the general Core DEV database connection.
 */
const TABLES = [
  "ai_platform.dev_gpt02_task_attempt_binding_claims",
  "ai_platform.dev_gpt02_binding_attestation_nonces",
];
function evaluateDedicatedWriter(input) {
  const reasons=[];
  const deny=(ok,reason)=>{if(ok!==true)reasons.push(reason);};
  deny(input.devRuntime,"DEV_RUNTIME_NOT_VERIFIED");
  deny(input.dedicatedConnectionConfigured,"DEDICATED_WRITER_DSN_MISSING");
  deny(input.dsnDistinct,"WRITER_REUSES_CORE_DATABASE_CREDENTIAL");
  deny(input.connected,"WRITER_CONNECTION_NOT_VERIFIED");
  deny(input.separateLogin,"WRITER_NOT_SEPARATE_LOGIN");
  deny(input.nonPrivileged,"WRITER_HAS_PRIVILEGED_DB_ROLE");
  deny(input.schemaReady,"BINDING_SCHEMA_MISSING");
  deny(input.insertBoth,"WRITER_INSERT_PRIVILEGES_MISSING");
  deny(input.noReadModifyDelete,"WRITER_HAS_EXCESS_TABLE_PRIVILEGES");
  deny(input.noCoreCommandWrite,"WRITER_CAN_MUTATE_CORE_COMMAND");
  deny(input.noGrantLeaseWrite,"WRITER_CAN_MUTATE_GRANTS_OR_LEASES");
  // A database role is not an operator session, signer or native attestor.
  reasons.push("NO_TRUSTED_BINDING_ISSUER_IMPLEMENTED");
  return {environment:"DEV",readOnly:true,
    credentialIsolationVerified:reasons.every(x=>x==="NO_TRUSTED_BINDING_ISSUER_IMPLEMENTED"),
    releaseDecision:"NO_GO",blockingReasons:reasons,
    mayPersistBinding:false,mayIssueGrant:false,mayDispatchWorker:false,
    mayResume:false,mayCloseJob:false};
}
function safeDsnIdentity(s) {
  try {
    const u=new URL(s);
    if(!["postgresql:","postgres:"].includes(u.protocol))return null;
    return {username:decodeURIComponent(u.username),host:u.hostname,
      port:u.port||"5432",database:u.pathname.replace(/^\//,"")};
  }catch{return null;}
}
async function run() {
  const dev=process.env.APP_ENV==="development" && process.env.NODE_ENV!=="production";
  const dedicated=process.env.GPT02_BINDING_WRITER_DATABASE_URL_DEV||"";
  const general=process.env.SUPABASE_DEV_DATABASE_URL||"";
  const writer=safeDsnIdentity(dedicated),base=safeDsnIdentity(general);
  const distinct=!!(writer&&base&&dedicated!==general&&writer.username!==base.username);
  const snapshot={devRuntime:dev,dedicatedConnectionConfigured:!!writer,
    dsnDistinct:distinct,connected:false,separateLogin:false,
    nonPrivileged:false,schemaReady:false,insertBoth:false,
    noReadModifyDelete:false,noCoreCommandWrite:false,noGrantLeaseWrite:false};
  if(!dev||!distinct){
    process.stdout.write(JSON.stringify(evaluateDedicatedWriter(snapshot))+"\n");return;
  }
  let Client;
  try{({Client}=require("pg"))}catch{
    const fs=require("node:fs"),path=require("node:path");
    const store="/app/node_modules/.pnpm";
    try {
      const pkg=fs.readdirSync(store).filter(x=>/^pg@8\./.test(x)).sort().at(-1);
      if(pkg)({Client}=require(path.join(store,pkg,"node_modules/pg")));
    }catch{}
  }
  if(!Client) {
    process.stdout.write(JSON.stringify(evaluateDedicatedWriter(snapshot))+"\n");return;
  }
  const c=new Client({connectionString:dedicated,connectionTimeoutMillis:5000,
    statement_timeout:6500,application_name:"gpt02_dedicated_writer_readonly_preflight"});
  try {
    await c.connect();
    await c.query("BEGIN READ ONLY");
    const a=await c.query(`SELECT current_user AS actual_login,
      (SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb
       FROM pg_roles WHERE rolname=current_user) AS elevated,
      to_regclass($1) IS NOT NULL AS claim_ready,
      to_regclass($2) IS NOT NULL AS nonce_ready,
      to_regclass('ai_platform.ai_coding_bridge_commands') IS NOT NULL AS commands_ready,
      to_regclass('ai_platform.dev_gpt02_resume_grants') IS NOT NULL AS grants_ready,
      to_regclass('ai_platform.dev_gpt02_resume_command_leases') IS NOT NULL AS leases_ready`,TABLES);
    const v=a.rows[0];
    snapshot.connected=true;
    snapshot.separateLogin=v.actual_login===writer.username &&
      writer.username!==base.username && writer.username!=="postgres";
    snapshot.nonPrivileged=v.elevated===false;
    snapshot.schemaReady=v.claim_ready===true&&v.nonce_ready===true;
    if(snapshot.schemaReady) {
      const b=await c.query(`SELECT
       has_table_privilege(current_user,$1,'INSERT') AS claim_insert,
       has_table_privilege(current_user,$2,'INSERT') AS nonce_insert,
       (has_table_privilege(current_user,$1,'SELECT') OR
        has_table_privilege(current_user,$1,'UPDATE') OR
        has_table_privilege(current_user,$1,'DELETE') OR
        has_table_privilege(current_user,$2,'SELECT') OR
        has_table_privilege(current_user,$2,'UPDATE') OR
        has_table_privilege(current_user,$2,'DELETE')) AS excess,
       (CASE WHEN to_regclass('ai_platform.ai_coding_bridge_commands') IS NULL THEN false
        ELSE has_table_privilege(current_user,'ai_platform.ai_coding_bridge_commands','INSERT,UPDATE,DELETE')
        END) AS command_mutation,
       (CASE WHEN to_regclass('ai_platform.dev_gpt02_resume_grants') IS NULL THEN false
        ELSE has_table_privilege(current_user,'ai_platform.dev_gpt02_resume_grants','INSERT,UPDATE,DELETE')
        END) AS grant_mutation,
       (CASE WHEN to_regclass('ai_platform.dev_gpt02_resume_command_leases') IS NULL THEN false
        ELSE has_table_privilege(current_user,'ai_platform.dev_gpt02_resume_command_leases','INSERT,UPDATE,DELETE')
        END) AS lease_mutation`,TABLES);
      const x=b.rows[0];
      snapshot.insertBoth=x.claim_insert===true&&x.nonce_insert===true;
      snapshot.noReadModifyDelete=x.excess===false;
      snapshot.noCoreCommandWrite=x.command_mutation===false;
      snapshot.noGrantLeaseWrite=x.grant_mutation===false&&x.lease_mutation===false;
    }
    await c.query("ROLLBACK");
  }catch(e){
    try{await c.query("ROLLBACK")}catch{}
    // No DSNs, SQL, usernames, passwords or connection errors in output.
    snapshot.connected=false;
  }finally{await c.end().catch(()=>{})}
  process.stdout.write(JSON.stringify(evaluateDedicatedWriter(snapshot))+"\n");
}
module.exports={evaluateDedicatedWriter,safeDsnIdentity};
if(require.main===module)run().catch(()=>{
 process.stdout.write(JSON.stringify(evaluateDedicatedWriter({}))+"\n");
});
