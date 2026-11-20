/**
 * CST-DEV independent QA receipt verifier — pure cryptographic contract.
 * No HTTP route, secrets, key issuance, DB writes, worker activation or dispatch.
 * This verifier MUST run outside the inspected Core AI/DELL worker process.
 * Caller supplies a trusted, pre-pinned Ed25519 PUBLIC key out of band.
 *
 * A correctly signed PRE_ADMISSION receipt proves only the signature and
 * exact bound claims. It does NOT by itself authorize waiting->queued.
 * A POST_EXECUTION receipt is a separate evidence type, never Final ACK.
 */
import {createHash,createPublicKey,verify, type KeyObject} from "node:crypto";

export const QA_DOMAIN="cst-onejob-independent-qa/v1";
export type QaStage="PRE_ADMISSION"|"POST_EXECUTION";
export type QaClaims={
  domain:string;stage:QaStage;project:string;companyId:string;
  approvalId:string;jobId:number;requestId:string;workerName:string;
  sourceSha:string;imageId:string;verifierId:string;nonce:string;
  verifiedAt:string;expiresAt:string; evidenceDigest:string;
};
export type SignedQaReceipt={
  claims:QaClaims; signatureBase64:string; publicKeyFingerprint:string;
};
type Expected={
  project:string;approvalId:string;jobId:number;requestId:string;
  workerName:string;sourceSha:string;imageId:string;stage:QaStage;
  verifierId:string;publicKeyPem:string;trustedFingerprint:string;nowIso:string;
};
const HEX40=/^[a-f0-9]{40}$/,HEX64=/^[a-f0-9]{64}$/;
const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const REQUEST=/^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$/;
const WORKER=/^cst-dev-dell-onejob-[0-9]{8}-[a-f0-9]{8}$/;
const VERIFIER=/^cst-independent-qa-[a-z0-9_-]{8,80}$/;
const KEYS=["domain","stage","project","companyId","approvalId","jobId",
 "requestId","workerName","sourceSha","imageId","verifierId","nonce",
 "verifiedAt","expiresAt","evidenceDigest"] as const;

export function qaCanonicalBytes(claims:QaClaims):Buffer {
  const obj:Record<string,unknown>={};
  for(const key of KEYS)obj[key]=claims[key];
  return Buffer.from(JSON.stringify(obj),"utf8");
}
function fingerprint(key:KeyObject):string {
  return createHash("sha256").update(key.export({type:"spki",format:"der"})).digest("hex");
}
export function reviewSignedIndependentQaReceipt(receipt:SignedQaReceipt, expected:Expected){
  const failures:string[]=[];
  const check=(ok:boolean,name:string)=>{if(!ok)failures.push(name)};
  const c=receipt?.claims;
  check(Boolean(c&&typeof c==="object"&&!Array.isArray(c) &&
   Object.keys(c).length===KEYS.length &&
   KEYS.every(k=>Object.prototype.hasOwnProperty.call(c,k))),
   "CANONICAL_CLAIMS_SHAPE_INVALID");
  if(!c)return {status:"DENIED",failures:["CLAIMS_MISSING"],dispatchPermitted:false,finalAckVerified:false};
  check(c.domain===QA_DOMAIN&&c.stage===expected.stage,"WRONG_DOMAIN_OR_STAGE");
  check(c.project==="xssrfshdrtdfupgqwfdw"&&expected.project===c.project
    &&c.companyId==="1","WRONG_DEV_PROJECT_OR_COMPANY");
  check(ID.test(c.approvalId)&&c.approvalId===expected.approvalId &&
    Number.isSafeInteger(c.jobId)&&c.jobId>0&&c.jobId!==482&&c.jobId===expected.jobId,
    "APPROVAL_OR_JOB_MISMATCH");
  check(REQUEST.test(c.requestId)&&c.requestId===expected.requestId &&
    WORKER.test(c.workerName)&&c.workerName===expected.workerName,
    "REQUEST_OR_WORKER_MISMATCH");
  check(HEX40.test(c.sourceSha)&&c.sourceSha===expected.sourceSha &&
    /^sha256:[a-f0-9]{64}$/.test(c.imageId)&&c.imageId===expected.imageId,
    "IMAGE_SOURCE_MISMATCH");
  check(VERIFIER.test(c.verifierId)&&c.verifierId===expected.verifierId,
    "UNTRUSTED_VERIFIER_ID");
  check(HEX64.test(c.nonce)&&HEX64.test(c.evidenceDigest),"NONCE_OR_EVIDENCE_DIGEST_INVALID");
  const now=Date.parse(expected.nowIso),start=Date.parse(c.verifiedAt),end=Date.parse(c.expiresAt);
  check(Number.isFinite(now)&&Number.isFinite(start)&&Number.isFinite(end)&&
    start<=now&&now<end&&end>start&&end-start<=5*60*1000,"RECEIPT_EXPIRED_OR_UNBOUNDED");
  check(HEX64.test(receipt.publicKeyFingerprint)&&
    receipt.publicKeyFingerprint===expected.trustedFingerprint,
    "UNTRUSTED_PUBLIC_KEY_FINGERPRINT");
  let key:KeyObject|null=null;
  try {
    key=createPublicKey(expected.publicKeyPem);
    check(key.asymmetricKeyType==="ed25519" &&
      fingerprint(key)===expected.trustedFingerprint,
      "PINNED_KEY_NOT_ED25519_OR_FINGERPRINT_MISMATCH");
  } catch {check(false,"PINNED_PUBLIC_KEY_UNAVAILABLE")}
  let signatureOk=false;
  try {
    const raw=Buffer.from(receipt.signatureBase64,"base64");
    if(key&&raw.length===64&&raw.toString("base64")===receipt.signatureBase64 &&
      failures.length===0){
      signatureOk=verify(null,qaCanonicalBytes(c),key,raw);
    }
  } catch {}
  check(signatureOk,"SIGNATURE_NOT_VERIFIED");
  return {
    status:failures.length===0?"CRYPTOGRAPHIC_BINDING_VALID":"DENIED",
    failures,canonicalDigest:createHash("sha256").update(qaCanonicalBytes(c)).digest("hex"),
    // MUST be combined with independently obtained source evidence, a
    // trusted verifier process, transaction-local replay lock and one-use
    // consumption. Never turn this result into a transition permit.
    dispatchPermitted:false,queueTransitionAuthorized:false,finalAckVerified:false,
  } as const;
}
