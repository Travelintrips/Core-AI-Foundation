/**
 * CST-DEV one-job: independently signed pre-Owner readiness (NO dispatch).
 * Only a separate root-owned QA custodian can deposit this short-lived proof.
 * A passing proof is necessary but never sufficient for job admission.
 * No credentials, DB mutation, worker claim or signing private key.
 */
import {createHash,createPublicKey,verify} from "node:crypto";
import {openSync,readFileSync,closeSync,fstatSync,lstatSync,realpathSync,constants} from "node:fs";

const PROJECT="xssrfshdrtdfupgqwfdw";
const TRUST="/etc/cst-onejob-qa/trust/public-root.json";
const PROOF="/var/lib/cst-onejob-qa/preapproval-ready.json";
const DOMAIN="CST_DEV_ONEJOB_PRE_OWNER_READINESS_V1\n";
const SHA40=/^[a-f0-9]{40}$/;
const SHA64=/^[a-f0-9]{64}$/;
const WORKER=/^cst-dev-dell-onejob-[0-9]{8}-[a-f0-9]{8}$/;
const RFC3339=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const FIELDS=[
 "version","purpose","project","companyId","sourceSha","workerName",
 "imageDigest","brokerAclVerified","dedicatedTransportVerified",
 "subscriberArmed","independentAgentsReachable","finalAckIssuerArmed",
 "operatorChangeId","nonce","issuedAt","expiresAt","verifierId"
] as const;
type Plain=Record<string,unknown>;
type Trust={use:string;project:string;verifierId:string;publicKeyPem:string;fingerprint:string};
const isObj=(v:unknown):v is Plain=>!!v&&typeof v==="object"&&!Array.isArray(v);
const exact=(v:unknown,keys:readonly string[])=>isObj(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const hash=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
const date=(v:unknown)=>{
 if(typeof v!=="string"||!RFC3339.test(v))return NaN;
 const ms=Date.parse(v);
 return Number.isFinite(ms)&&new Date(ms).toISOString()===v?ms:NaN;
};
function canonical(claims:Plain):Buffer{
 return Buffer.from(DOMAIN+JSON.stringify(Object.fromEntries(
  FIELDS.map(k=>[k,claims[k]]))),"utf8");
}
export function verifyOneJobPreapproval(
 envelope:unknown,trust:unknown,expected:{sourceSha:string;workerName:string},
 now:Date=new Date()
){
 const blockers:string[]=[];
 const need=(ok:boolean,code:string)=>{if(!ok)blockers.push(code)};
 const claims=isObj(envelope)?envelope.claims:undefined;
 const trustObj=isObj(trust)?trust as Trust:null;
 const m=isObj(claims)?claims:null;
 need(exact(envelope,["claims","signatureBase64"]),"SIGNED_PROOF_SHAPE_INVALID");
 need(exact(claims,FIELDS),"SIGNED_READINESS_CLAIMS_INVALID");
 let key:ReturnType<typeof createPublicKey>|null=null;
 try{
  if(!trustObj||!exact(trust,["use","project","verifierId","publicKeyPem","fingerprint"])||
    trustObj.use!=="CST_DEV_ONEJOB_QA_PUBLIC_PIN"||
    trustObj.project!==PROJECT||
    !/^cst-independent-qa-[a-z0-9_-]{8,80}$/.test(trustObj.verifierId)||
    !SHA64.test(trustObj.fingerprint))throw Error("QA_TRUST_INVALID");
  key=createPublicKey(trustObj.publicKeyPem);
  if(key.asymmetricKeyType!=="ed25519" ||
    hash(key.export({type:"spki",format:"der"}) as Buffer)!==trustObj.fingerprint)
   throw Error("QA_TRUST_NOT_PINNED");
 }catch{key=null;}
 need(!!key,"INDEPENDENT_QA_TRUST_NOT_PINNED");
 if(m){
  const issued=date(m.issuedAt),expires=date(m.expiresAt),current=now.getTime();
  need(m.version===1 && m.purpose==="CST_DEV_ONEJOB_ONE_OWNER_PREPARED"&&
    m.project===PROJECT && m.companyId==="1"&&
    m.sourceSha===expected.sourceSha && SHA40.test(String(m.sourceSha))&&
    m.workerName===expected.workerName && WORKER.test(String(m.workerName)),
    "PREAPPROVAL_DEV_JOB_SCOPE_MISMATCH");
  need(typeof m.imageDigest==="string"&&/^sha256:[a-f0-9]{64}$/.test(m.imageDigest),
    "PREAPPROVAL_IMAGE_DIGEST_INVALID");
  need(m.brokerAclVerified===true&&m.dedicatedTransportVerified===true&&
    m.subscriberArmed===true&&m.independentAgentsReachable===true&&
    m.finalAckIssuerArmed===true,
    "INDEPENDENT_BROKER_SUBSCRIBER_OR_AGENT_NOT_READY");
  need(typeof m.operatorChangeId==="string"&&
    /^CST-DEV-[A-Z0-9-]{6,50}$/.test(m.operatorChangeId)&&
    SHA64.test(String(m.nonce))&&
    m.verifierId===trustObj?.verifierId,
    "INDEPENDENT_QA_LINEAGE_INVALID");
  need(Number.isFinite(current)&&Number.isFinite(issued)&&Number.isFinite(expires)&&
    issued<=current&&current<expires&&
    expires-issued>0&&expires-issued<=300_000,
    "PREAPPROVAL_EXPIRED_OR_UNBOUNDED");
 }
 let signed=false;
 if(key&&m&&exact(claims,FIELDS)&&isObj(envelope)){
  const sig=envelope.signatureBase64;
  if(typeof sig==="string"&&/^[A-Za-z0-9+/]{86}==$/.test(sig)){
   try{
    const raw=Buffer.from(sig,"base64");
    signed=raw.length===64&&raw.toString("base64")===sig&&
      verify(null,canonical(m),key,raw);
   }catch{signed=false}
  }
 }
 need(signed,"INDEPENDENT_QA_SIGNATURE_NOT_VERIFIED");
 return {
  proofLevel:"INDEPENDENT_SIGNED_PREAPPROVAL_NOT_OWNER_CONSENT",
  verified:blockers.length===0,blockers,
  ownerConsentRecorded:false,queueTransitionAuthorized:false,
  dispatchPermitted:false,finalAckVerified:false,
 } as const;
}
function rootOwnedJson(path:string,maxBytes:number){
 // File paths are constants, never request-controlled. Check every parent.
 const parents=path===TRUST?
  ["/etc","/etc/cst-onejob-qa","/etc/cst-onejob-qa/trust"]:
  ["/var","/var/lib","/var/lib/cst-onejob-qa"];
 for(const p of parents){
  const s=lstatSync(p);
  if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||
     (s.mode&0o022)!==0||realpathSync(p)!==p)
    throw Error("ONEJOB_QA_PARENT_CUSTODY_INVALID");
 }
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const s=fstatSync(fd);
  if(!s.isFile()||s.uid!==0||(s.mode&0o022)!==0||
     s.nlink!==1||s.size<1||s.size>maxBytes)
    throw Error("ONEJOB_QA_EVIDENCE_CUSTODY_INVALID");
  return JSON.parse(readFileSync(fd,{encoding:"utf8"}));
 }finally{closeSync(fd);}
}
export function readIndependentlySignedPreapproval(expected:{sourceSha:string;workerName:string}){
 try{
  const trust=rootOwnedJson(TRUST,8192);
  const envelope=rootOwnedJson(PROOF,16384);
  return verifyOneJobPreapproval(envelope,trust,expected);
 }catch{
  return {
   proofLevel:"INDEPENDENT_SIGNED_PREAPPROVAL_NOT_OWNER_CONSENT",
   verified:false,blockers:["INDEPENDENT_PREAPPROVAL_CUSTODY_NOT_INSTALLED"],
   ownerConsentRecorded:false,queueTransitionAuthorized:false,
   dispatchPermitted:false,finalAckVerified:false,
  } as const;
 }
}
