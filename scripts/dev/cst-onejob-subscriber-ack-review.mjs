/**
 * Ed25519 subscriber receipt review, distinct from the QA signer domain.
 * Reads exact bytes from an independently observed event delivery.
 * Pure and never issues Final ACK or dispatch authority.
 */
import {createHash,createPublicKey,verify} from "node:crypto";
export const ACK_DOMAIN="cst-onejob-subscriber-delivery/v1";
const PROJECT="xssrfshdrtdfupgqwfdw";
const KEYS=["domain","project","companyId","jobId","approvalId","eventId",
  "deliveryId","subscriberId","correlationId","deliveryDigest","nonce",
  "acknowledgedAt","expiresAt"];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX=/^[0-9a-f]{64}$/;
const SUB=/^cst-onejob-subscriber-[a-z0-9_-]{4,64}$/;
const sha=x=>createHash("sha256").update(x).digest("hex");
export function subscriberAckCanonicalBytes(c) {
  const o={};
  for(const key of KEYS)o[key]=c?.[key];
  return Buffer.from(JSON.stringify(o),"utf8");
}
export function reviewSignedSubscriberAck({
  signedAck,expected,pinnedTrust,deliveredBytes,nowIso
}) {
  const errors=[];
  const check=(ok,code)=>{if(!ok)errors.push(code)};
  const c=signedAck?.claims;
  check(c&&typeof c==="object"&&!Array.isArray(c)&&
    Object.keys(c).length===KEYS.length&&
    KEYS.every(k=>Object.prototype.hasOwnProperty.call(c,k)),
    "SUBSCRIBER_ACK_SHAPE_INVALID");
  if(!c)return {status:"DENIED",errors:["SUBSCRIBER_ACK_MISSING"],
    finalAckIssued:false,dispatchPermitted:false};
  check(c.domain===ACK_DOMAIN&&c.project===PROJECT&&c.companyId==="1",
    "SUBSCRIBER_ACK_DOMAIN_OR_PROJECT_MISMATCH");
  check(Number.isSafeInteger(c.jobId)&&c.jobId>0&&c.jobId!==482&&
    UUID.test(c.approvalId)&&UUID.test(c.eventId)&&UUID.test(c.deliveryId)&&
    UUID.test(c.correlationId)&&SUB.test(c.subscriberId)&&
    HEX.test(c.nonce)&&HEX.test(c.deliveryDigest),
    "SUBSCRIBER_ACK_IDENTIFIERS_INVALID");
  for(const k of ["jobId","approvalId","eventId","deliveryId",
    "subscriberId","correlationId","deliveryDigest"])
    check(c[k]===expected?.[k],"SUBSCRIBER_ACK_BINDING_MISMATCH:"+k);
  const now=Date.parse(nowIso),ts=Date.parse(c.acknowledgedAt),expiry=Date.parse(c.expiresAt);
  check(Number.isFinite(now)&&Number.isFinite(ts)&&Number.isFinite(expiry)&&
    ts<=now&&now<expiry&&expiry>ts&&expiry-ts<=5*60*1000,
    "SUBSCRIBER_ACK_TTL_INVALID");
  check(Buffer.isBuffer(deliveredBytes)&&deliveredBytes.length>0&&
    deliveredBytes.length<=65536&&sha(deliveredBytes)===c.deliveryDigest,
    "SUBSCRIBER_DELIVERY_BYTES_NOT_BOUND");
  check(pinnedTrust?.use==="CST_DEV_ONEJOB_SUBSCRIBER_PUBLIC_PIN"&&
    pinnedTrust?.project===PROJECT&&pinnedTrust?.subscriberId===c.subscriberId&&
    HEX.test(pinnedTrust?.fingerprint||"")&&
    signedAck.publicKeyFingerprint===pinnedTrust.fingerprint,
    "SUBSCRIBER_PUBLIC_TRUST_NOT_PINNED");
  let key=null;
  try{
    key=createPublicKey(pinnedTrust.publicKeyPem);
    check(key.asymmetricKeyType==="ed25519"&&
      sha(key.export({type:"spki",format:"der"}))===pinnedTrust.fingerprint,
      "SUBSCRIBER_KEY_FINGERPRINT_MISMATCH");
  }catch{check(false,"SUBSCRIBER_PUBLIC_KEY_UNAVAILABLE")}
  let ok=false;
  try{
    const signature=Buffer.from(signedAck.signatureBase64,"base64");
    if(key&&signature.length===64&&
       signature.toString("base64")===signedAck.signatureBase64&&errors.length===0)
      ok=verify(null,subscriberAckCanonicalBytes(c),key,signature);
  }catch{}
  check(ok,"SUBSCRIBER_SIGNATURE_INVALID");
  return {status:errors.length?"DENIED":"CRYPTOGRAPHIC_SUBSCRIBER_ACK_VALID",
    errors,receiptDigest:sha(subscriberAckCanonicalBytes(c)),
    finalAckIssued:false,dispatchPermitted:false};
}
