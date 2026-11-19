/** Read-only, fail-closed pilot admission diagnostic. NEVER executes a job.
 * Run on the authorized CST DEV VPS. It never prints credentials or a DSN.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { probeCstDevHostGateway } from "./cst-team-host-gateway-probe.mjs";

const PROJECT = "xssrfshdrtdfupgqwfdw";
const HOST = "dev.cstlogistic.co.id";
const RETIRED_VHOST = "/etc/nginx/sites-enabled/dev-aicore.cstlogistic.co.id";
const CANDIDATE = "cst-core-onejob-dev-candidate";
const CORE = "core-ai-dev";
const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function shell(binary,args,timeout=8500) {
  try { return execFileSync(binary,args,{encoding:"utf8",timeout,stdio:["ignore","pipe","ignore"]}).trim(); }
  catch { return null; }
}
function inspect(format,name,type="container") {
  return shell("docker",[type,"inspect",name,"--format",format]);
}
const dbReadOnlyJs = String.raw`
const pg=require("/app/lib/db/node_modules/pg");
const raw=process.env.SUPABASE_DATABASE_URL_DEV||process.env.SUPABASE_DEV_DATABASE_URL||"";
let u;try{u=new URL(raw)}catch{console.log(JSON.stringify({status:"NO_DEV_DB_CONFIG"}));process.exit(0)}
const expected="xssrfshdrtdfupgqwfdw";
if(!(u.hostname.includes(expected)||u.username.endsWith("."+expected))||
   raw.includes("nzdweipzckfszczzqtuw")){
  console.log(JSON.stringify({status:"WRONG_DB_PROJECT"}));process.exit(0)
}
(async()=>{
 const c=new pg.Client({connectionString:raw,ssl:{rejectUnauthorized:false},
   connectionTimeoutMillis:4500,query_timeout:4500});
 try{
  await c.connect();await c.query("BEGIN READ ONLY");
  const r=await c.query("select current_database() as db,current_user as role,"+
   " (select count(*)::int from pg_roles where rolname like 'cst_team_model_pilot_%') as role_count,"+
   " (select count(*)::int from pg_roles where rolname like 'cst_team_model_pilot_%'"+
   " and rolcanlogin and not rolsuper and not rolbypassrls and not rolinherit"+
   " and not rolcreaterole and not rolcreatedb"+
   " and rolvaliduntil > now() + interval '2 minutes'"+
   " and rolvaliduntil < now() + interval '45 minutes') as safe_role_count");
  const v=r.rows[0];
  const uniqueIndex=await c.query("select count(*)::int as n from pg_index i "+
    "join pg_class idx on idx.oid=i.indexrelid "+
    "join pg_class tbl on tbl.oid=i.indrelid "+
    "join pg_namespace ns on ns.oid=tbl.relnamespace "+
    "where ns.nspname='ai_platform' and tbl.relname='ai_jobs' "+
    "and idx.relname='ai_jobs_company1_pilot_request_unique' "+
    "and i.indisunique and i.indisvalid and i.indisready "+
    "and pg_get_indexdef(i.indexrelid) like '%payload_json%requestId%' "+
    "and pg_get_indexdef(i.indexrelid) like '%cst-ai-team-company1-dev:pilot-%'");
  const uniqueIndexPresent=uniqueIndex.rows[0]?.n===1;
  const jobId=Number(process.env.CST_TEAM_DEV_APPROVED_JOB_ID);
  const workerName=process.env.CST_TEAM_DEV_APPROVED_WORKER_NAME||"";
  let job=null,matchingRequestCount=null,existingWorker=null;
  if(Number.isSafeInteger(jobId)&&jobId>0&&jobId!==482){
    const j=await c.query("select id,status,job_type,payload_json->>'requestId' as request_id,"+
      "payload_json->>'modelId' as model_id from ai_platform.ai_jobs where id=$1",[jobId]);
    job=j.rows[0]||null;
    if(job?.request_id){
      const duplicates=await c.query("select count(*)::int as n from ai_platform.ai_jobs where payload_json->>'requestId'=$1",[job.request_id]);
      matchingRequestCount=duplicates.rows[0]?.n??null;
    }
  }
  if(/^cst-dev-dell-onejob-[0-9]{8}-[0-9a-f]{8}$/.test(workerName)){
    const w=await c.query("select count(*)::int as count from ai_platform.ai_workers where worker_name=$1",[workerName]);
    existingWorker=w.rows[0]?.count??null;
  }
  console.log(JSON.stringify({status:"DEV_DB_READ_ONLY_PASS",
    database:v.db,role:v.role,roleCount:v.role_count,safeRoleCount:v.safe_role_count,
    jobId:job?.id??null,jobStatus:job?.status??null,jobType:job?.job_type??null,
    jobRequestId:job?.request_id??null,jobModel:job?.model_id??null,
    matchingRequestCount,uniqueIndexPresent,
    workerName:workerName||null,workerExistingCount:existingWorker,
    enrollmentConfigured:Boolean(process.env.OLLAMA_REMOTE_ENROLLMENT_SECRET),
    oneJobGuardConfigured:process.env.NODE_ENV==="development" &&
       process.env.APP_ENV==="development" &&
       process.env.CST_TEAM_DEV_SCOPED_MODEL_CLAIM_ENABLED==="true" &&
       Number.isSafeInteger(jobId) && jobId>0 && Boolean(workerName)}));
 }catch(e){console.log(JSON.stringify({status:"DEV_DB_READ_ERROR",errorCode:e.code||e.name}))}
 finally{await c.query("ROLLBACK").catch(()=>{});await c.end().catch(()=>{})}
})()`;
function readDevCatalog(containerName) {
 const raw = shell("docker",["exec",containerName,"node","-e",dbReadOnlyJs],12000);
 try { return JSON.parse(raw); } catch { return {status:"DEV_CATALOG_UNAVAILABLE"}; }
}
/** An advisory report only. Even a clear report grants no dispatch or Final ACK. */
export function projectOneJobGate(data) {
 const blockers=[];
 const deny=(condition,reason)=>{if(!condition)blockers.push(reason)};
 deny(data.sourceSha?.length===40 &&
      (data.imageSourceSha===data.sourceSha || data.sourceContentEquivalent===true),
      "SOURCE_IMAGE_COMMIT_MISMATCH");
 deny(/^sha256:[0-9a-f]{64}$/.test(data.imageId||""),"CANDIDATE_IMAGE_MISSING");
 deny(/^[0-9a-f]{40}$/.test(data.imageBuildMarkerSha||"") &&
      data.imageBuildMarkerSha===data.imageSourceSha,
      "IMAGE_BUILD_SHA_MARKER_MISMATCH");
 deny(data.candidateRunning===true && data.candidateHealthy===true &&
      data.candidateImageId===data.imageId,"BLUE_GREEN_RUNTIME_NOT_HEALTHY_OR_DIFFERENT_IMAGE");
 deny(data.candidateNetworkIsolated===true,"BLUE_GREEN_NETWORK_ISOLATION_NOT_PROVEN");
 deny(data.candidateHostGatewayBlocked===true,"HOST_GATEWAY_ACCESS_NOT_BLOCKED_OR_UNVERIFIED");
 // Gateway nonce denial alone does not validate all host/IPv6/outbound routes
 // or the dedicated database transport. Until separate independently observed
 // evidence exists, these remain false and no job may be admitted.
 deny(data.candidateIndependentNetworkAclVerified===true,
      "CANDIDATE_EGRESS_ACL_NOT_INDEPENDENTLY_VERIFIED");
 deny(data.candidateDedicatedDevDbTransportVerified===true,
      "DEDICATED_CST_DEV_DB_TRANSPORT_NOT_VERIFIED");
 deny(data.devHostResolved===true,"UNIFIED_DEV_HOST_DNS_MISSING");
 deny(data.retiredHostQuarantined===true,"RETIRED_DEV_HOST_NOT_QUARANTINED");
 deny(data.candidateDirectHealthy===true,"CANDIDATE_LOOPBACK_HEALTH_UNVERIFIED");
 deny(data.nginxApiRetainsExistingCore===true,"SHARED_DEV_API_ROUTE_CHANGED");
 deny(data.dbStatus==="DEV_DB_READ_ONLY_PASS" && data.database==="postgres" &&
      data.dbRole?.startsWith("cst_team_model_pilot_")===true,
      "CANDIDATE_DB_LOGIN_NOT_SCOPED_PILOT_ROLE");
 deny(data.roleCount===1 && data.safeRoleCount===1,"ONE_JOB_ROLE_MISSING_OR_UNSAFE");
 deny(data.matchingRequestCount===1,"PILOT_REQUEST_ID_NOT_UNIQUE");
 deny(data.uniqueIndexPresent===true,"PILOT_DB_UNIQUE_REQUEST_CONSTRAINT_MISSING");
 deny(Number.isSafeInteger(data.jobId) && data.jobId>0 && data.jobId!==482 &&
      data.jobQueued===true && data.jobCompany==="1" &&
      data.jobModel==="qwen2.5:3b","FRESH_COMPANY1_MODEL_JOB_NOT_PROVEN");
 deny(/^cst-dev-dell-onejob-[0-9]{8}-[0-9a-f]{8}$/.test(data.workerName||"") &&
      data.workerName!=="cst-dev-dell-onejob-20261119" &&
      data.workerAlreadyRegistered===false,"FRESH_WORKER_IDENTITY_NOT_PROVEN");
 deny(data.enrollmentConfigured===true && data.oneJobGuardConfigured===true,
      "ONE_JOB_ENROLLMENT_OR_GUARD_NOT_CONFIGURED");
 return {check:"CST_DEV_ONE_JOB_PRELAUNCH",mode:"READ_ONLY_ADVISORY_NO_DISPATCH",
   pilotAdmissionReady:blockers.length===0,blockers,
   operationalE2EVerified:false,subscriberReceiptVerified:false,
   independentFinalAckVerified:false,sideEffects:"NONE"};
}
async function main() {
 const sha=shell("git",["-C",ROOT,"rev-parse","HEAD"])||"";
 const tag=process.argv[2]||"core-ai-dev:cst-onejob-"+sha.slice(0,8)+"-qa";
 if(!/^core-ai-dev:cst-onejob-[0-9a-f]{8}-qa$/.test(tag)) throw new Error("INVALID_CANDIDATE_IMAGE_TAG");
 const imageRaw=inspect('{{.Id}}|{{index .Config.Labels "cst.qa.source_commit"}}',tag,"image");
 const [imageId,imageSourceSha]=imageRaw?.split("|")||[];
 // A documentation or diagnostic-only PR commit does not require rebuilding an
 // already-tested backend: accept only an ancestral image with zero code/SQL diff.
 const ancestor=/^[0-9a-f]{40}$/.test(imageSourceSha||"") &&
   shell("git",["-C",ROOT,"merge-base","--is-ancestor",imageSourceSha,sha])!==null;
 const runtimeChanges=ancestor?shell("git",["-C",ROOT,"diff","--name-only",
   imageSourceSha,sha,"--","artifacts/api-server","lib/db",
   "scripts/dev/cst-team-onejob-ephemeral-role-template.sql",
   "scripts/dev/cst-team-onejob-ephemeral-role-rollback-template.sql"]):null;
 const sourceContentEquivalent=ancestor && runtimeChanges==="";
 const running=inspect("{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.Image}}|{{.HostConfig.NetworkMode}}",CANDIDATE);
 const [isRunning,health,candidateImageId,networkMode]=running?.split("|")||[];
 // Read the marker from the running, isolated QA candidate. Never execute the
 // application entrypoint or read any environment/secret values here.
 const imageBuildMarkerSha=isRunning==="true" ?
   shell("docker",["exec",CANDIDATE,"node","-e",
     "try{process.stdout.write(require('node:fs').readFileSync('/app/.cst-build-sha','utf8').trim())}catch{process.exit(2)}"]) : null;
 // The candidate should run without ANY published host ports on an
 // --internal bridge with gateway_mode_ipv4=isolated. This avoids assigning
 // a host-gateway IP, unlike an ordinary internal Docker bridge.
 const portBindingsRaw=inspect('{{json .HostConfig.PortBindings}}',CANDIDATE);
 let noPublishedHostPorts=false;
 try {
   const bindings=JSON.parse(portBindingsRaw);
   noPublishedHostPorts=bindings===null ||
     (bindings && typeof bindings==="object" && !Array.isArray(bindings) &&
      Object.keys(bindings).length===0);
 } catch {}
 const pilotNet="cst-core-onejob-dev-net";
 const networkRaw=networkMode===pilotNet ?
   shell("docker",["network","inspect",pilotNet,"--format",'{{json .}}']):null;
 let networkMembersSafe=false,hostGatewayUnassigned=false;
 try {
   const network=JSON.parse(networkRaw);
   const members=Object.values(network.Containers||{});
   const options=network.Options||{};
   const ipam=network.IPAM?.Config;
   hostGatewayUnassigned=Array.isArray(ipam) && ipam.length>0 &&
     ipam.every(x=>!x?.Gateway);
   networkMembersSafe=network.Driver==="bridge" && network.Internal===true &&
     network.EnableIPv6===false &&
     options["com.docker.network.bridge.gateway_mode_ipv4"]==="isolated" &&
     members.length===1 && members[0]?.Name===CANDIDATE;
 } catch {}
 const networkScopeSafe=networkMode===pilotNet && networkMembersSafe &&
   hostGatewayUnassigned && noPublishedHostPorts;
 // Exact-candidate namespace probes: no IPv4/IPv6 default route, and no
 // connectivity to the current healthy Core DEV private Docker IP. Only
 // ENETUNREACH/EHOSTUNREACH count as denial, never refused or timed out.
 let candidateRoutesAbsent=false,candidateCoreCrossNetworkDenied=false;
 if(networkScopeSafe && isRunning==="true"){
   const routeJs=String.raw`
const fs=require("node:fs");
const v4=fs.readFileSync("/proc/net/route","utf8").split("\n").slice(1);
const has4=v4.some(x=>x.trim().split(/\s+/)[1]==="00000000");
let has6=true;
try { const v6=fs.readFileSync("/proc/net/ipv6_route","utf8");
  has6=v6.split("\n").some(x=>/^0{32}\s+00\s+/.test(x)); } catch {}
console.log(!has4&&!has6?"NO_DEFAULT_ROUTE":"ROUTE_PRESENT");`;
   candidateRoutesAbsent=shell("docker",["exec",CANDIDATE,"node","-e",routeJs],4500)==="NO_DEFAULT_ROUTE";
   const coreIp=inspect('{{(index .NetworkSettings.Networks "ai-core-workers_control").IPAddress}}',CORE);
   if(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(coreIp||"")){
     const tcpJs=String.raw`
const net=require("node:net");
const s=net.connect({host:process.argv[1],port:3000});
s.setTimeout(1800);
s.on("connect",()=>{console.log("REACHABLE");s.destroy()});
s.on("error",e=>console.log(e.code||"UNVERIFIED"));
s.on("timeout",()=>{console.log("UNVERIFIED");s.destroy()});`;
     const outcome=shell("docker",["exec",CANDIDATE,"node","-e",tcpJs,coreIp],4500);
     candidateCoreCrossNetworkDenied=["ENETUNREACH","EHOSTUNREACH"].includes(outcome);
   }
 }
 // No host gateway exists for the isolated bridge. This is a necessary
 // topology check only: the independent ACL and DEV DB transport gates remain
 // false, regardless of a successful local namespace probe.
 let hostGatewayProbe={blocked:false,status:"NOT_PROBED"};
 if(networkScopeSafe && candidateRoutesAbsent && candidateCoreCrossNetworkDenied){
   hostGatewayProbe={blocked:true,status:"ISOLATED_GATEWAY_UNASSIGNED_NO_ROUTES"};
 } else if(networkMode===pilotNet && isRunning==="true" && !hostGatewayUnassigned){
   const raw=shell("docker",["network","inspect",pilotNet,"--format",'{{json .IPAM.Config}}']);
   let gateway=null;
   try { gateway=JSON.parse(raw)?.[0]?.Gateway??null; } catch {}
   if(gateway) hostGatewayProbe=await probeCstDevHostGateway({gateway,candidate:CANDIDATE});
 }
 let hostResolved=false,candidateDirectHealthy=false,retiredHostQuarantined=false;
 let nginxApiRetainsExistingCore=false;
 try {
   const active=readFileSync("/etc/nginx/sites-enabled/dev.cstlogistic.co.id","utf8");
   const exactApi=active.match(/location\s+\^~\s+\/api\/\s*\{([^}]*)\}/);
   const destination=exactApi?.[1]?.match(/proxy_pass\s+http:\/\/127\.0\.0\.1:([0-9]+)\s*;/);
   const existingBindings=inspect('{{json .HostConfig.PortBindings}}',CORE);
   const existingPort=JSON.parse(existingBindings)?.["3000/tcp"]?.[0];
   nginxApiRetainsExistingCore=Boolean(destination && existingPort &&
     existingPort.HostIp==="127.0.0.1" &&
     Number(destination[1])===Number(existingPort.HostPort));
 } catch {}
 try{const target=await lookup(HOST);hostResolved=Boolean(target?.address)}catch{}
 try {
   const retired=readFileSync(RETIRED_VHOST,"utf8");
   retiredHostQuarantined=/server_name\s+dev-aicore\.cstlogistic\.co\.id;/.test(retired) &&
     (retired.match(/return\s+410;/g)||[]).length>=2 &&
     !/proxy_pass\s+[^;]+;/.test(retired);
 } catch {}
 // For gateway_mode=isolated there is no published host port. Read
 // liveness and source header from inside the named container only.
 if(networkScopeSafe && isRunning==="true"){
   const healthJs=String.raw`
fetch("http://127.0.0.1:3000/api/healthz",{signal:AbortSignal.timeout(2500)})
.then(r=>console.log(JSON.stringify({status:r.status,
  commit:r.headers.get("x-cst-source-commit")||r.headers.get("x-cst-commit-sha")})))
.catch(()=>{process.exitCode=2});`;
   const raw=shell("docker",["exec",CANDIDATE,"node","-e",healthJs],4700);
   try {
     const health=JSON.parse(raw);
     candidateDirectHealthy=health.status===200 &&
       Boolean(sourceContentEquivalent || imageSourceSha===sha) &&
       health.commit===imageSourceSha;
   } catch {}
 }
 const db=readDevCatalog(isRunning==="true" ? CANDIDATE : CORE);
 const facts={sourceSha:sha,imageId,imageSourceSha,imageBuildMarkerSha,sourceContentEquivalent,
   candidateRunning:isRunning==="true",candidateHealthy:health==="healthy",
   candidateImageId,candidateNetworkIsolated:networkScopeSafe && candidateRoutesAbsent && candidateCoreCrossNetworkDenied,
   candidateHostGatewayBlocked:hostGatewayProbe.blocked,
   // No authoritative ACL / database transport inspector is wired yet.
   // Never infer either proof from Docker --internal, DNS, the host nonce or
   // a successful SQL SELECT. Do not accept env flags as authorization.
   candidateIndependentNetworkAclVerified:false,
   candidateDedicatedDevDbTransportVerified:false,
   devHostResolved:hostResolved,retiredHostQuarantined,candidateDirectHealthy,
   nginxApiRetainsExistingCore,
   dbStatus:db.status,database:db.database,dbRole:db.role,
   roleCount:db.roleCount,safeRoleCount:db.safeRoleCount,
   jobId:db.jobId,matchingRequestCount:db.matchingRequestCount,
   uniqueIndexPresent:db.uniqueIndexPresent,
   jobQueued:db.jobStatus==="queued" && db.jobType==="ollama_model_invocation",
   jobCompany:typeof db.jobRequestId==="string" &&
     /^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$/.test(db.jobRequestId) ? "1" : null,
   jobModel:db.jobModel,workerName:db.workerName,
   workerAlreadyRegistered:db.workerExistingCount===0 ? false : null,
   enrollmentConfigured:db.enrollmentConfigured,oneJobGuardConfigured:db.oneJobGuardConfigured};
 const verdict=projectOneJobGate(facts);
 console.log(JSON.stringify({...verdict,observedAt:new Date().toISOString(),
   project:PROJECT,devHost:HOST,sourceSha:sha,imageSourceSha:imageSourceSha||null,
   imageBuildMarkerMatchesLabel:imageBuildMarkerSha===imageSourceSha,
   gatewayProbeStatus:hostGatewayProbe.status,
   networkGatewayMode:"isolated", noPublishedHostPorts,
   candidateRoutesAbsent,candidateCoreCrossNetworkDenied,
   sourceContentEquivalent,imagePresent:Boolean(imageId),candidateRunning:facts.candidateRunning,
   devHostResolved:hostResolved,retiredHostQuarantined,dbReadStatus:db.status,
   roleCount:db.roleCount??null},null,2));
 if(!verdict.pilotAdmissionReady) process.exitCode=2;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 main().catch(e=>{console.log(JSON.stringify({mode:"READ_ONLY_ADVISORY_NO_DISPATCH",
   pilotAdmissionReady:false,blockers:["PREFLIGHT_READ_FAILED"],
   errorType:e.name,sideEffects:"NONE"}));process.exitCode=2});
}
