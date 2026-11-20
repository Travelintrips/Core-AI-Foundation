/**
 * One command, one offline evidence summary — never a live pilot launcher.
 * Executes existing PASS regressions together, without duplicating them.
 *
 * Usage:
 *   node scripts/dev/cst-team-onejob-batch-qa.mjs --plan
 *   CST_ONEJOB_DISPOSABLE_QA=true node scripts/dev/cst-team-onejob-batch-qa.mjs --offline-full
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT=resolve(fileURLToPath(new URL("../..",import.meta.url)));
const MODE=process.argv[2]??"--plan";
const DOC="docs/dev/cst-team-onejob-single-batch-closeout.md";
const tests=[
 "scripts/dev/cst-team-onejob-owner-approval-receipt.test.mjs",
 "scripts/dev/cst-team-onejob-owner-session-intent.test.mjs",
 "scripts/dev/cst-team-onejob-subscriber-consumer-qa.test.mjs",
 "scripts/dev/cst-team-onejob-subscriber-receipt.test.mjs",
 "scripts/dev/cst-team-onejob-broker-acl-lifecycle-qa.test.mjs",
 "scripts/dev/cst-team-onejob-nft-egress-qa.test.mjs",
 "scripts/dev/cst-team-onejob-peercred-broker.test.mjs",
 "scripts/dev/cst-team-onejob-fixed-db-broker.test.mjs",
 "scripts/dev/cst-team-onejob-broker-pg-integration.test.mjs",
 "scripts/dev/cst-team-onejob-broker-tls-negative.test.mjs",
 "scripts/dev/cst-team-onejob-pg-socket.test.mjs",
 "scripts/dev/cst-team-onejob-unix-peer-boundary.test.mjs",
 "scripts/dev/cst-team-onejob-ca-pin.test.mjs",
 "scripts/dev/cst-team-onejob-readiness-gate.test.mjs",
 "scripts/dev/cst-team-host-gateway-probe.test.mjs",
 "scripts/pg-pool-max.test.mjs",
];
const checklist=Object.freeze([
 "Owner's independently authenticated one-time approval for a NEW Company-1 job",
 "Independent non-root production-class broker with pre-traffic ACL and pinned CST-DEV TLS",
 "Short-lived scoped CST-DEV model and subscriber logins under verified RLS",
 "Separately custodied subscriber signer with durable unique receipt readback",
 "One real fresh Company-1 model invocation and atomic completion event",
 "Four truly independent agent attestation receipts and signed Final ACK",
 "Rollback/relock, one-job idempotency and unmodified PROD and historical #482",
]);
const safeEnv={};
for(const key of ["PATH","HOME","LANG","LC_ALL","TMPDIR","DOCKER_HOST"]) {
 if(typeof process.env[key]==="string")safeEnv[key]=process.env[key];
}
safeEnv.CST_ONEJOB_DISPOSABLE_QA="true";
// The batch process never gives QA children passwords, DB URLs, bearer tokens
// or Supabase environment variables. Network-none test containers create their
// own short-lived, synthetic machine credentials in their private mount.
function exec(binary,args,timeoutMs=90000) {
 const start=Date.now();
 const p=spawnSync(binary,args,{
  cwd:ROOT,env:safeEnv,encoding:"utf8",timeout:timeoutMs,maxBuffer:16*1024*1024,
  stdio:["ignore","pipe","pipe"],
 });
 return {ok:p.status===0 && !p.error,code:p.status,ms:Date.now()-start,
  stdout:p.stdout??"",errorType:p.error?.code??null};
}
const report={
 check:"CST_DEV_SINGLE_BATCH_QA",
 sourceSha:null,mode:MODE,scope:"CST_DEV_ONLY_COMPANY1_NEW_JOB",
 liveDevDatabaseAccess:false,prodAccess:false,dispatchPermitted:false,
 historicalJob482Replayed:false,independentOwnerApproved:false,
 realDevE2EVerified:false,independentFinalAckVerified:false,
 releaseDecision:"NO_GO",
 checks:[],remainingLiveGates:checklist,
};
function show(exit) {
 process.stdout.write(JSON.stringify(report,null,2)+"\n");
 process.exitCode=exit;
}
if(!["--plan","--offline-full"].includes(MODE) || process.argv.length>3) {
 report.error="INVALID_COMMAND_ONLY_PLAN_OR_OFFLINE_FULL";
 show(3);
} else if(!existsSync(resolve(ROOT,DOC)) || !tests.every(t=>existsSync(resolve(ROOT,t)))) {
 report.error="EXACT_SOURCE_QA_BUNDLE_INCOMPLETE";
 show(3);
} else if(MODE==="--plan") {
 report.offlineQaStatus="NOT_RUN_PLAN_ONLY";
 report.remainingBuildItems=checklist;
 show(0);
} else if(process.env.CST_ONEJOB_DISPOSABLE_QA!=="true") {
 report.error="EXPLICIT_NETWORK_NONE_QA_OPT_IN_REQUIRED";
 show(3);
} else {
 const git=exec("git",["rev-parse","HEAD"],5000);
 report.sourceSha=git.ok?git.stdout.trim():null;
 if(!/^[a-f0-9]{40}$/.test(report.sourceSha||"")) {
  report.error="SOURCE_SHA_UNVERIFIED";show(3);
 } else {
  const tasks=[
   ["source-regression",process.execPath,["--experimental-strip-types","--test",...tests],30000],
   ["kernel-peer-credentials","python3",["scripts/dev/test_cst_team_onejob_peercred.py","-q"],12000],
   ["isolated-model-role-rls","python3",["-B","scripts/dev/cst-team-dedicated-model-role-rehearsal.py"],70000],
   ["isolated-prestage-waiting-only","python3",["-B","scripts/dev/cst-team-onejob-prestage-rls-pg16-qa.py"],70000],
   ["isolated-subscriber-role-rotation","python3",["-B","scripts/dev/cst-team-onejob-independent-subscriber-role-rehearsal.py"],70000],
   ["isolated-scram-signer-receipt","python3",["-B","scripts/dev/cst-team-onejob-subscriber-functional-rls-qa.py"],70000],
   ["operational-broker-signed-manifest","python3",["-B","scripts/dev/test_cst_team_onejob_operational_broker.py"],12000],
   ["operational-broker-network-none","bash",["scripts/dev/cst-team-onejob-operational-broker-no-network-qa.sh"],35000],
   ["db-typescript",existsSync(resolve(ROOT,"node_modules/.bin/tsc")) ?
     "node_modules/.bin/tsc" : "lib/db/node_modules/.bin/tsc",
     ["--noEmit","-p","lib/db/tsconfig.json"],70000],
   ["source-whitespace","git",["diff","--check"],5000],
  ];
  // One test group may fail; keep collecting independent QA failures, but
  // never attempt to promote this to a live release on any outcome.
  for(const [name,binary,args,timeout] of tasks){
   const result=exec(binary,args,timeout);
   report.checks.push({name,pass:result.ok,durationMs:result.ms,
     exitCode:result.code,errorType:result.errorType});
  }
  // Actual VPS preflight is read-only; NO_GO/exit 2 is required while a
  // fresh owner-authorized job and real broker/subscriber are not present.
  const pre=exec(process.execPath,[
   "scripts/dev/cst-team-onejob-readiness-gate.mjs",
   "core-ai-dev:cst-onejob-9fabedcd-qa",
  ],20000);
  let observation=null;
  try{observation=JSON.parse(pre.stdout)}catch{}
  const safeNoGo=pre.code===2 &&
   observation?.pilotAdmissionReady===false &&
   observation?.sideEffects==="NONE" &&
   Array.isArray(observation.blockers) &&
   observation.blockers.includes("INDEPENDENT_OWNER_APPROVAL_NOT_ATTESTED") &&
   observation.blockers.includes("INDEPENDENT_ONEJOB_SUBSCRIBER_NOT_ARMED");
  report.checks.push({name:"read-only-live-admission-remains-locked",pass:safeNoGo,
   durationMs:pre.ms,exitCode:pre.code,errorType:pre.errorType});
  const allPass=report.checks.every(x=>x.pass);
  report.offlineQaStatus=allPass?"PASS":"FAIL";
  report.passCount=report.checks.filter(x=>x.pass).length;
  report.totalCount=report.checks.length;
  report.operationalAuthorityGranted=false;
  report.releaseDecision="NO_GO";
  show(allPass?0:2);
 }
}
