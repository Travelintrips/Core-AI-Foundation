#!/usr/bin/env node
/**
 * Approved, single-use DEV subscriber PULL adapter. Default DENY.
 *
 * The existing independently read, signed and atomically persisted subscriber
 * implementation does all business work. This process only supplies the
 * independently provisioned PG identity, pinned public trust and external
 * signer socket. The signer PRIVATE key never enters this process.
 *
 * No password/key generation, IAM/role/SQL migration, dispatch or PROD access.
 * A source file alone is neither approval nor a running independent service.
 */
import {createHash,createPublicKey} from "node:crypto";
import {openSync,readFileSync,closeSync,fstatSync,lstatSync,realpathSync,constants} from "node:fs";
import {dirname} from "node:path";
import {connect} from "node:net";
import {fileURLToPath} from "node:url";
import {createPinnedCstOneJobPgConnection} from "../../lib/db/src/cstOneJobPinnedSupabaseCa.ts";
import {pullExactlyOneCstJobCompletion}
  from "./cst-onejob-independent-subscriber-pull.mjs";

const PROJECT="xssrfshdrtdfupgqwfdw";
const LOGIN="cst_onejob_subscriber_login";
const TRUST="/etc/cst-onejob-subscriber/trust/public-root.json";
const RELEASE="/etc/cst-onejob-qa/approval/subscriber-release.json";
const SOCKET="/run/cst-onejob-subscriber/sign.sock";
const DB_KEY="CST_DEV_ONEJOB_SUBSCRIBER_DATABASE_URL";
const SUB=/^cst-onejob-subscriber-[a-z0-9_-]{4,64}$/;
const WORKER=/^cst-dev-dell-onejob-[0-9]{8}-[a-f0-9]{8}$/;
const SHA40=/^[a-f0-9]{40}$/;
const SHA64=/^[a-f0-9]{64}$/;
const releaseFields=["version","purpose","project","companyId","jobId",
  "sourceSha","workerName","subscriberId","publicKeyFingerprint","operatorUid","signerUid",
  "changeId","issuedAt","expiresAt"];
const trustFields=["use","project","subscriberId","publicKeyPem","fingerprint"];
const exact=(obj,fields)=>obj&&typeof obj==="object"&&!Array.isArray(obj)&&
  Object.keys(obj).length===fields.length&&fields.every(k=>Object.hasOwn(obj,k));
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const iso=x=>typeof x==="string"&&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x)&&
  Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x;

export function reviewIndependentSubscriberGate(env,jobId) {
  const blockers=[],need=(ok,reason)=>{if(!ok)blockers.push(reason)};
  need(env.APP_ENV==="development"&&env.NODE_ENV==="development","DEV_ONLY");
  need(env.SUPABASE_URL_DEV==="https://"+PROJECT+".supabase.co","PROJECT_MISMATCH");
  need(env.CST_DEV_ONEJOB_INDEPENDENT_SUBSCRIBER_ENABLED==="true","SUBSCRIBER_DISABLED");
  need(env.AI_DISPATCHER_ENABLED==="false"&&env.OLLAMA_WORKER_RUNTIME_ENABLED==="false",
    "GENERIC_DISPATCH_NOT_DISABLED");
  need(!env.SUPABASE_PROD_DATABASE_URL&&!env.DATABASE_URL_PROD&&
    !env.DATABASE_URL&&!env.SUPABASE_DEV_DATABASE_URL,
    "SHARED_OR_PROD_CONNECTION_FORBIDDEN");
  need(SHA40.test(env.CST_TEAM_DEV_APPROVED_SOURCE_SHA||""),"SOURCE_SHA_NOT_PINNED");
  need(WORKER.test(env.CST_TEAM_DEV_APPROVED_WORKER_NAME||""),"WORKER_NOT_PINNED");
  need(Number.isSafeInteger(jobId)&&jobId>482,"ONE_NEW_JOB_REQUIRED");
  need(typeof env[DB_KEY]==="string"&&env[DB_KEY].length>0,
    "DEDICATED_SUBSCRIBER_CREDENTIAL_MISSING");
  return {ready:blockers.length===0,blockers,project:PROJECT,
    releaseDecision:"NO_GO",dispatchPermitted:false,finalAckIssued:false};
}

export function reviewIndependentSubscriberRelease(release,trust,scope,now=Date.now()){
  const blockers=[],need=(ok,reason)=>{if(!ok)blockers.push(reason)};
  need(exact(release,releaseFields),"RELEASE_SHAPE_INVALID");
  need(exact(trust,trustFields),"SUBSCRIBER_TRUST_SHAPE_INVALID");
  let pinValid=false;
  try{
    const key=createPublicKey(trust.publicKeyPem);
    pinValid=key.asymmetricKeyType==="ed25519"&&
      hash(key.export({type:"spki",format:"der"}))===trust.fingerprint;
  }catch{}
  need(pinValid,"SUBSCRIBER_PUBLIC_PIN_INVALID");
  need(release?.version===1&&release?.purpose==="CST_DEV_ONEJOB_SIGNED_SUBSCRIBER"&&
    release.project===PROJECT&&release.companyId==="1"&&
    Number.isSafeInteger(release.jobId)&&release.jobId>482&&
    release.jobId===scope.jobId&&release.sourceSha===scope.sourceSha&&
    release.workerName===scope.workerName&&
    SHA40.test(release.sourceSha||"")&&WORKER.test(release.workerName||""),
    "AUTHORIZED_JOB_SCOPE_INVALID");
  need(release?.subscriberId===trust?.subscriberId&&
    release?.publicKeyFingerprint===trust?.fingerprint&&
    SUB.test(release?.subscriberId||"")&&SHA64.test(release?.publicKeyFingerprint||"")&&
    trust?.use==="CST_DEV_ONEJOB_SUBSCRIBER_PUBLIC_PIN"&&trust?.project===PROJECT,
    "SUBSCRIBER_SIGNER_TRUST_MISMATCH");
  const stamp=Date.parse(release?.issuedAt),expiry=Date.parse(release?.expiresAt);
  need(iso(release?.issuedAt)&&iso(release?.expiresAt)&&
    Number.isFinite(now)&&stamp<=now&&now<expiry&&
    expiry-stamp>0&&expiry-stamp<=5*60_000,"RELEASE_EXPIRED_OR_UNBOUNDED");
  need(typeof release?.changeId==="string"&&
    /^CST-DEV-[A-Z0-9-]{6,50}$/.test(release.changeId)&&
    Number.isSafeInteger(release?.operatorUid)&&release.operatorUid>0&&
    Number.isSafeInteger(release?.signerUid)&&release.signerUid>0&&
    release.operatorUid!==release.signerUid,
    "INDEPENDENT_CHANGE_OR_SIGNER_UID_MISSING");
  return {ready:blockers.length===0,blockers,releaseDecision:"NO_GO",
    dispatchPermitted:false,finalAckIssued:false};
}

function readFixedRootJson(path,parents){
  for(const dir of parents){
    const s=lstatSync(dir);
    if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||
       (s.mode&0o022)!==0||realpathSync(dir)!==dir)
      throw Error("ROOT_CUSTODY_PARENT_DENIED");
  }
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const s=fstatSync(fd);
    if(!s.isFile()||s.uid!==0||s.nlink!==1||
       (s.mode&0o022)!==0||s.size<1||s.size>8192||
       realpathSync(path)!==path)
      throw Error("ROOT_CUSTODY_FILE_DENIED");
    return JSON.parse(readFileSync(fd,{encoding:"utf8"}));
  }finally{closeSync(fd)}
}

export async function signViaIndependentSocket(bytes,socketPath=SOCKET,signerUid){
  if(!Buffer.isBuffer(bytes)||bytes.length<64||bytes.length>8192||
     !Number.isSafeInteger(signerUid)||signerUid<=0||
     typeof process.getuid!=="function"||signerUid===process.getuid())
    throw Error("SIGNER_INDEPENDENT_IDENTITY_DENIED");
  const parent=dirname(socketPath);
  const dir=lstatSync(parent),socketInfo=lstatSync(socketPath);
  if(!dir.isDirectory()||dir.isSymbolicLink()||dir.uid!==signerUid||
     (dir.mode&0o027)!==0||
     !socketInfo.isSocket()||socketInfo.isSymbolicLink()||
     socketInfo.uid!==signerUid||(socketInfo.mode&0o002)!==0)
    throw Error("SIGNER_SOCKET_CUSTODY_DENIED");
  return new Promise((resolve,reject)=>{
    const socket=connect({path:socketPath});
    const chunks=[];let size=0,done=false;
    const finish=(err,result)=>{
      if(done)return;
      done=true;socket.destroy();
      if(err)reject(err);else resolve(result);
    };
    socket.setTimeout(3500);
    socket.once("connect",()=>{
      const header=Buffer.alloc(4);header.writeUInt32BE(bytes.length);
      socket.write(Buffer.concat([header,bytes]));
    });
    socket.on("data",chunk=>{
      size+=chunk.length;
      if(size>64)return finish(Error("SIGNER_RESPONSE_TOO_LONG"));
      chunks.push(chunk);
    });
    socket.once("end",()=>{
      if(size!==64)return finish(Error("SIGNER_RESPONSE_INVALID"));
      finish(null,Buffer.concat(chunks).toString("base64"));
    });
    socket.once("error",err=>finish(err));
    socket.once("timeout",()=>finish(Error("SIGNER_TIMEOUT")));
  });
}

export async function main(args=process.argv.slice(2),env=process.env){
  const denied=(reason,blockers=[])=>({status:"DENIED",reason,blockers,
    project:PROJECT,releaseDecision:"NO_GO",dispatchPermitted:false,
    finalAckIssued:false,independentFinalAckVerified:false});
  if(args.length!==2||args[0]!=="--consume-approved-dev"||
     !/^[1-9]\d{0,9}$/.test(args[1]))
    return denied("EXPLICIT_ONE_JOB_INVOCATION_REQUIRED");
  const jobId=Number(args[1]),gate=reviewIndependentSubscriberGate(env,jobId);
  if(!gate.ready)return denied("INDEPENDENT_SUBSCRIBER_NOT_PROVISIONED",gate.blockers);
  // The inspected shared Core application must never run this as root.
  if(typeof process.getuid!=="function"||process.getuid()===0)
    return denied("INDEPENDENT_NONROOT_PROCESS_REQUIRED");
  try{
    const release=readFixedRootJson(RELEASE,
      ["/etc","/etc/cst-onejob-qa","/etc/cst-onejob-qa/approval"]);
    const trust=readFixedRootJson(TRUST,
      ["/etc","/etc/cst-onejob-subscriber","/etc/cst-onejob-subscriber/trust"]);
    const permitted=reviewIndependentSubscriberRelease(release,trust,{
      jobId,sourceSha:env.CST_TEAM_DEV_APPROVED_SOURCE_SHA,
      workerName:env.CST_TEAM_DEV_APPROVED_WORKER_NAME,
    });
    if(!permitted.ready)return denied("RELEASE_OR_TRUST_NOT_AUTHORIZED",permitted.blockers);
    if(process.getuid()!==release.operatorUid)
      return denied("DEDICATED_OPERATOR_UID_MISMATCH");
    const config=createPinnedCstOneJobPgConnection(env[DB_KEY],LOGIN);
    const {default:pg}=await import("pg");
    const client=new pg.Client({...config,connectionTimeoutMillis:3500,
      statement_timeout:4500,application_name:"cst-dev-onejob-independent-subscriber"});
    let connected=false;
    try{
      await client.connect();connected=true;
      const proof=await pullExactlyOneCstJobCompletion({
        client,jobId,expectedSubscriberId:trust.subscriberId,pinnedTrust:trust,
        signBytes:bytes=>signViaIndependentSocket(bytes,SOCKET,release.signerUid),
      });
      return {status:"SUBSCRIBER_ACK_PERSISTED_NOT_FINAL_ACK",
        project:PROJECT,jobId,eventId:proof.eventId,deliveryId:proof.deliveryId,
        releaseDecision:"NO_GO",dispatchPermitted:false,finalAckIssued:false,
        independentFinalAckVerified:false};
    }finally{if(connected)await client.end().catch(()=>{})}
  }catch{
    return denied("AUTHORIZED_CUSTODY_OR_SIGNED_SUBSCRIBER_UNAVAILABLE");
  }
}
if(import.meta.url===`file://${process.argv[1]}`){
  const report=await main();
  process.stdout.write(JSON.stringify(report)+"\n");
  if(report.status!=="SUBSCRIBER_ACK_PERSISTED_NOT_FINAL_ACK")
    process.exitCode=2;
}
