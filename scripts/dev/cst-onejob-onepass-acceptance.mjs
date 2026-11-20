#!/usr/bin/env node
/**
 * One-command DEV one-job acceptance inventory and offline rehearsal.
 * Safe: never issues credentials, signatures, roles, queue permits or ACK.
 * It does not change any connected database or active service.
 *
 * Usage:
 *   node scripts/dev/cst-onejob-onepass-acceptance.mjs --manifest
 *   node scripts/dev/cst-onejob-onepass-acceptance.mjs --offline
 *   node scripts/dev/cst-onejob-onepass-acceptance.mjs --full-readonly
 */
import {spawnSync} from "node:child_process";
import {existsSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
const ROOT=fileURLToPath(new URL("../../",import.meta.url));
export const PROJECT="xssrfshdrtdfupgqwfdw";
const node=process.execPath;

export const OFFLINE_TESTS=Object.freeze([
  {id:"cst_team_onejob_readiness_gate",argv:[node,"--test","scripts/dev/cst-team-onejob-readiness-gate.test.mjs"]},
  {id:"generic_enqueue",argv:[node,"--experimental-strip-types","--test","scripts/dev/cst-onejob-generic-enqueue-deny.test.mjs"]},
  {id:"owner_approval",argv:[node,"--experimental-strip-types","--test","scripts/dev/cst-onejob-owner-approval-review.test.mjs"]},
  {id:"owner_stage",argv:[node,"--test","scripts/dev/cst-onejob-owner-stage-contract.test.mjs"]},
  {id:"admission_review",argv:[node,"--experimental-strip-types","--test","scripts/dev/cst-onejob-waiting-admission-review.test.mjs"]},
  {id:"cst_onejob_onepass_acceptance",argv:[node,"--test","scripts/dev/cst-onejob-onepass-acceptance.test.mjs"]},
  {id:"broker_fail_closed",argv:[node,"--test","scripts/dev/cst-onejob-broker-proposal-failclosed.test.mjs"]},
  {id:"qa_signature",argv:[node,"--experimental-strip-types","--test","scripts/dev/cst-onejob-independent-qa-verifier.test.mjs"]},
  {id:"signed_locked_binding",argv:[node,"--experimental-strip-types","--test","scripts/dev/cst-onejob-signed-handoff-review.test.mjs"]},
  {id:"signed_concurrency_pg",argv:[node,"--experimental-strip-types","--test","scripts/dev/cst-onejob-signed-handoff-disposable.test.mjs"]},
  {id:"qa_offline",argv:[node,"--experimental-strip-types","--test","scripts/dev/cst-onejob-independent-qa-offline.test.mjs"]},
  {id:"cst_onejob_qa_trust_custody",argv:[node,"--test","scripts/dev/cst-onejob-qa-trust-custody.test.mjs"]},
  {id:"qa_host_custody",argv:[node,"--test","scripts/dev/cst-onejob-independent-qa-host-preflight.test.mjs"]},
  {id:"cst_team_onejob_image_provenance",argv:[node,"--test","scripts/dev/cst-team-onejob-image-provenance.test.mjs"]},
  {id:"stamp_dev_build_sha",argv:[node,"--test","scripts/dev/stamp-dev-build-sha.test.mjs"]},
  {id:"cst_team_dedicated_model_role_rehearsal",argv:["python3","scripts/dev/cst-team-dedicated-model-role-rehearsal.py"]},
  {id:"owner_ledger_pg",argv:["python3","scripts/dev/cst-onejob-owner-ledger-disposable.py"]},
  {id:"writer_rls_pg",argv:["python3","scripts/dev/cst-onejob-writer-rls-disposable.py"]},
  {id:"stage_pooler_tls",argv:[node,"--experimental-strip-types","--test","scripts/dev/cst-onejob-stage-connection-config.test.mjs"]},
  {id:"cst_onejob_live_readiness",argv:[node,"--test","scripts/dev/cst-onejob-live-readiness.test.mjs"]},
  {id:"post_execution_subscriber_final_ack",argv:[node,"--experimental-strip-types","--test","scripts/dev/cst-onejob-postexecution-review.test.mjs"]},
  {id:"atomic_broker_event_outbox_candidate",argv:[node,"--test","scripts/dev/cst-onejob-broker-operational-disposable.test.mjs"]},
  {id:"trusted_qa_broker_same_transaction",argv:[node,"--experimental-strip-types","--test","scripts/dev/cst-onejob-trusted-admission-bridge.test.mjs"]},
  {id:"signed_subscriber_and_independent_final_ack",argv:[node,"--experimental-strip-types","--test","scripts/dev/cst-onejob-final-ack-candidate.test.mjs"]},
]);
export const LIVE_GATES=Object.freeze([
  "DEDICATED_STAGING_LOGIN_AND_APPROVED_SECRET_CUSTODY",
  "INDEPENDENT_QA_IDENTITY_KEY_AND_SOURCE_PROVENANCE",
  "LIVE_VERIFIED_RECEIPT_LEDGER_AND_ATOMIC_ADMISSION_BROKER",
  "REAL_SUBSCRIBER_DELIVERY_AND_SIGNED_RECEIPT",
  "INDEPENDENT_POST_EXECUTION_RECONCILIATION_AND_FINAL_ACK"
]);

export function verifyManifest(exists=existsSync) {
  const problems=[];
  const ids=new Set();
  for(const test of OFFLINE_TESTS) {
    if(ids.has(test.id))problems.push("DUPLICATE_GATE:"+test.id);
    ids.add(test.id);
    const file=test.argv.at(-1);
    if(typeof file!=="string"||!file.startsWith("scripts/dev/")||
      file.includes("..")||!exists(resolve(ROOT,file)))
      problems.push("MISSING_TEST:"+test.id);
  }
  for(const mandatory of ["owner_stage","stage_pooler_tls","qa_signature",
    "signed_locked_binding","broker_fail_closed","owner_ledger_pg",
    "writer_rls_pg","signed_concurrency_pg"])
    if(!ids.has(mandatory))problems.push("REQUIRED_GATE_MISSING:"+mandatory);
  return {valid:problems.length===0,problems,count:OFFLINE_TESTS.length};
}

function safeOfflineEnvironment(env) {
  const copy={};
  for(const [key,value] of Object.entries(env)) {
    if(/(PASSWORD|SECRET|TOKEN|CREDENTIAL|DATABASE_URL|DB_URL|SUPABASE|PRIVATE_KEY|API_KEY|AUTHORIZATION)/i.test(key))
      continue;
    copy[key]=value;
  }
  return copy;
}
function executeTest(test,env=process.env){
  const child=spawnSync(test.argv[0],test.argv.slice(1),{
    cwd:ROOT,env:safeOfflineEnvironment(env),encoding:"utf8",
    timeout:180_000,maxBuffer:2*1024*1024
  });
  return {id:test.id,status:child.status===0?"PASS":"FAIL",
    code:child.status===null?"TIMEOUT_OR_SPAWN_ERROR":String(child.status)};
}
function inspectLiveReadonly(env=process.env) {
  // Existing script performs read-only catalog SQL and always denies release.
  // No user-provided boolean or copied JSON can become operational approval.
  const child=spawnSync(node,["scripts/dev/cst-onejob-live-readiness.mjs"],{
    cwd:ROOT,env,encoding:"utf8",timeout:15_000,maxBuffer:256*1024
  });
  if(child.status!==0)return {status:"UNVERIFIED",blockers:["READ_ONLY_PROBE_FAILED"]};
  try {
    const report=JSON.parse(child.stdout.trim());
    if(report.project!==PROJECT||report.releaseDecision!=="NO_GO"||
       report.queueTransitionAuthorized!==false||report.dispatchPermitted!==false)
      return {status:"UNVERIFIED",blockers:["READ_ONLY_GATE_INVARIANT_VIOLATION"]};
    return {status:"READ_ONLY_PROBE",configPreflight:report.configPreflight,
      blockers:Array.isArray(report.blockers)?report.blockers.filter(x=>typeof x==="string"):[]};
  }catch{return {status:"UNVERIFIED",blockers:["READ_ONLY_REPORT_INVALID"]}}
}
export function acceptanceSummary({manifest,tests,live}){
  const offline=manifest.valid&&tests.length===OFFLINE_TESTS.length&&
    tests.every(x=>x.status==="PASS");
  return {
    project:PROJECT,
    scope:"CST_DEV_ONEJOB_NOT_PROD",
    manifest:manifest.valid?"PASS":"FAIL",
    testCount:tests.length,
    offlineResult:tests.length?offline?"PASS":"FAIL":"NOT_EXECUTED",
    tests,live:live??{status:"NOT_EXECUTED"},
    outstandingOperationalGates:LIVE_GATES,
    releaseDecision:"NO_GO",
    queueTransitionAuthorized:false,
    dispatchPermitted:false,
    signerActivationPermitted:false,
    finalAckIssued:false
  };
}
export async function main(args=process.argv.slice(2)){
  const modes=["--manifest","--offline","--full-readonly"];
  if(args.length!==1||!modes.includes(args[0])){
    console.log(JSON.stringify({status:"USAGE_DENIED",allowed:modes,
      releaseDecision:"NO_GO"}));
    return 2;
  }
  const manifest=verifyManifest();
  if(!manifest.valid){
    console.log(JSON.stringify(acceptanceSummary({manifest,tests:[],live:null})));
    return 1;
  }
  const tests=args[0]==="--manifest"?[]:OFFLINE_TESTS.map(test=>executeTest(test));
  const live=args[0]==="--full-readonly"?inspectLiveReadonly():null;
  const report=acceptanceSummary({manifest,tests,live});
  console.log(JSON.stringify(report,null,2));
  // Exit success only means offline tests passed, NOT operational GO.
  return tests.some(x=>x.status==="FAIL")?1:0;
}
if(import.meta.url==="file://"+process.argv[1])process.exitCode=await main();
