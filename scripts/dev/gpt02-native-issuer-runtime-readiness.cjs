"use strict";
/**
 * DEV-only, non-mutating native GPT02 issuer readiness audit.
 *
 * Runs within core-ai-dev. Reads safe DB catalog/status metadata, never
 * credentials, private keys, proof payloads, user identities or raw commands.
 * This is deliberately NOT a writer, signer, lease owner or authorization API.
 * All outputs are NO_GO until a distinct, independently verified issuer is
 * implemented, authenticated and acceptance-tested in DEV.
 */
const fs = require("node:fs");
const path = require("node:path");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function assessIssuerReadiness(snapshot) {
  const block = [];
  const add = (condition, name) => { if (!condition) block.push(name); };
  add(snapshot.devRuntime === true, "DEV_RUNTIME_NOT_VERIFIED");
  add(snapshot.databaseConnected === true, "DATABASE_READBACK_MISSING");
  add(snapshot.dbRoleLeastPrivilege === true, "ISOLATED_WRITER_ROLE_NOT_VERIFIED");
  add(snapshot.bindingClaimTablePresent === true, "BINDING_CLAIM_SCHEMA_MISSING");
  add(snapshot.bindingNonceTablePresent === true, "BINDING_NONCE_SCHEMA_MISSING");
  add(snapshot.reviewIntentTablePresent === true, "OPERATOR_REVIEW_INTENT_SCHEMA_MISSING");
  add(snapshot.grantTablePresent === true, "NATIVE_GRANT_SCHEMA_MISSING");
  add(snapshot.leaseTablePresent === true, "NATIVE_LEASE_SCHEMA_MISSING");
  add(snapshot.operatorPrincipalAvailable === true, "AUTHORIZED_OPERATOR_NOT_CONFIRMED");
  add(snapshot.commandNonterminal === true, "COMMAND_TERMINAL_OR_MISSING");
  add(snapshot.coreTaskLinked === true, "CORE_TASK_ID_MISSING");
  add(snapshot.trustedSignerReady === true, "TRUSTED_ISSUER_SIGNER_NOT_VERIFIED");
  add(snapshot.nativeAttestorReady === true, "INDEPENDENT_NATIVE_ATTESTOR_NOT_VERIFIED");
  add(snapshot.workerAckVerified === true, "NATIVE_WORKER_ACK_NOT_VERIFIED");
  // These can never be established by this read-only CLI, even if a caller
  // fabricates every boolean. A separate authenticated issuer is required.
  block.push("NO_TRUSTED_BINDING_ISSUER_IMPLEMENTED");
  return {schemaVersion:1,environment:"DEV",checks:{
    dbCatalogReadable:snapshot.databaseConnected===true,
    leastPrivilegeWriterVerified:snapshot.dbRoleLeastPrivilege===true,
    bindingClaimTablePresent:snapshot.bindingClaimTablePresent===true,
    bindingNonceTablePresent:snapshot.bindingNonceTablePresent===true,
    reviewIntentTablePresent:snapshot.reviewIntentTablePresent===true,
    grantTablePresent:snapshot.grantTablePresent===true,
    leaseTablePresent:snapshot.leaseTablePresent===true,
    eligibleOperatorExists:snapshot.operatorPrincipalAvailable===true,
    commandNonterminal:snapshot.commandNonterminal===true,
    coreTaskLinked:snapshot.coreTaskLinked===true,
    trustedSignerVerified:snapshot.trustedSignerReady===true,
    independentNativeAttestorVerified:snapshot.nativeAttestorReady===true,
    nativeAckVerified:snapshot.workerAckVerified===true,
  },blockingReasons:block,
  releaseDecision:"NO_GO",readOnly:true,mayPersistBinding:false,
  mayIssueGrant:false,mayDispatchWorker:false,mayResume:false,
  mayCloseJob:false};
}
module.exports = {assessIssuerReadiness};
function resolvePg() {
  try { return require("pg"); } catch {}
  const store="/app/node_modules/.pnpm";
  const candidates=fs.existsSync(store) ? fs.readdirSync(store).filter(x=>/^pg@8\./.test(x)).sort() : [];
  for (const x of candidates) {
    try { return require(path.join(store,x,"node_modules/pg")); } catch {}
  }
  throw Error("PG_CLIENT_NOT_AVAILABLE");
}
async function main() {
  const dev=process.env.APP_ENV==="development" && process.env.NODE_ENV!=="production";
  if (!dev) {
    process.stdout.write(JSON.stringify(assessIssuerReadiness({devRuntime:false}))+"\n");
    process.exitCode=2;return;
  }
  const id=process.env.GPT02_PREFLIGHT_COMMAND_ID;
  if (id && !UUID.test(id)) throw Error("INVALID_COMMAND_ID");
  const connectionString=process.env.SUPABASE_DEV_DATABASE_URL;
  if (!connectionString) throw Error("DEV_DB_CONNECTION_NOT_CONFIGURED");
  const {Client}=resolvePg();
  const db=new Client({connectionString,connectionTimeoutMillis:6000,statement_timeout:7500,
    application_name:"gpt02_dev_issuer_readiness_readonly"});
  let connected=false;
  try {
    await db.connect();connected=true;
    await db.query("BEGIN READ ONLY");
    const result=await db.query(`
      SELECT current_user AS runtime_role,
        (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user) AS privileged_role,
        to_regclass('ai_platform.dev_gpt02_task_attempt_binding_claims') IS NOT NULL AS claims,
        to_regclass('ai_platform.dev_gpt02_binding_attestation_nonces') IS NOT NULL AS nonces,
        to_regclass('ai_platform.dev_gpt02_operator_review_intents') IS NOT NULL AS reviews,
        to_regclass('ai_platform.dev_gpt02_resume_grants') IS NOT NULL AS grants,
        to_regclass('ai_platform.dev_gpt02_resume_command_leases') IS NOT NULL AS leases,
        EXISTS(SELECT 1 FROM ai_platform.internal_users
          WHERE role IN ('owner','admin') AND status='active' AND account_type='internal'
            AND must_change_password IS FALSE) AS eligible_operator,
        (SELECT status FROM ai_platform.ai_coding_bridge_commands
          WHERE id=$1::uuid LIMIT 1) AS command_status,
        (SELECT task_id IS NOT NULL FROM ai_platform.ai_coding_bridge_commands
          WHERE id=$1::uuid LIMIT 1) AS core_task_linked
      `,[id||"00000000-0000-4000-8000-000000000000"]);
    const row=result.rows[0];
    // Merely observing the current app database role is not proof of a
    // separately credentialed, least-privilege issuer/writer role.
    const diagnostic=assessIssuerReadiness({
      devRuntime:true,databaseConnected:true,dbRoleLeastPrivilege:false,
      bindingClaimTablePresent:row.claims,bindingNonceTablePresent:row.nonces,
      reviewIntentTablePresent:row.reviews,grantTablePresent:row.grants,
      leaseTablePresent:row.leases,operatorPrincipalAvailable:row.eligible_operator,
      commandNonterminal:row.command_status==="PROCESSING",
      coreTaskLinked:row.core_task_linked===true,
      trustedSignerReady:false,nativeAttestorReady:false,workerAckVerified:false,
    });
    await db.query("ROLLBACK");
    process.stdout.write(JSON.stringify({...diagnostic,
      runtimeRolePrivileged:row.privileged_role===true,
      commandState:row.command_status??"NOT_FOUND",
      commandIdProvided:Boolean(id),
      inspectionMode:"CORE_SERVICE_READ_ONLY_TRANSACTION"})+"\n");
  } catch(err) {
    if(connected){try{await db.query("ROLLBACK")}catch{}}
    process.stderr.write("READ_ONLY_READINESS_CHECK_FAILED:"+String(err?.code||"UNAVAILABLE")+"\n");
    process.exitCode=2;
  } finally {await db.end().catch(()=>{});}
}
if(require.main===module)main().catch(()=>{process.stderr.write("READINESS_CHECK_UNAVAILABLE\n");process.exitCode=2;});
