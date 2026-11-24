/**
 * CST-DEV DELL signer: pure Ed25519 release-evidence verifier, SOURCE ONLY.
 * The independent QA trust and expected facts MUST come from independently
 * reviewed OS-protected configuration and DB readback, never from the request.
 * This module cannot issue a signature, start a signer or authorize dispatch.
 * No filesystem, network, credential or service access.
 */
import {createHash, createPublicKey, verify} from "node:crypto";

export const PROJECT = "xssrfshdrtdfupgqwfdw";
export const DOMAIN = "CST_DEV_DELL_SIGNER_JOB_RELEASE_V1\n";
export const CLAIM_KEYS = Object.freeze([
  "version","domain","purpose","project","companyId","jobId","role",
  "workerName","sourceSha","approvalId","eventId","payloadSha256",
  "signerSid","clientSid","changeId","nonce","verifierId",
  "issuedAt","expiresAt"
]);
const TRUST_KEYS = ["use","project","verifierId","publicKeyPem","fingerprint"];
const EXPECTED_KEYS = [
  "project","companyId","jobId","role","workerName","sourceSha",
  "approvalId","eventId","payloadSha256","signerSid","clientSid",
  "changeId","qaRootFingerprint"
];
const ROLES = new Set(["coding","infrastructure","security","qa","reviewer"]);
const SHA40 = /^[a-f0-9]{40}$/, SHA64 = /^[a-f0-9]{64}$/;
const SID = /^S-1-5-21-(?:\d{1,10}-){3}\d{1,10}$/;
const WORKER = /^cst-dev-dell-onejob-[0-9]{8}-[a-f0-9]{8}$/;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const CHANGE = /^CST-DEV-[A-Z0-9-]{6,50}$/;
const DATE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const exact = (x, keys) => x && typeof x === "object" &&
  !Array.isArray(x) && Object.keys(x).length === keys.length &&
  keys.every(k => Object.hasOwn(x,k));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const millis = x => {
  if(typeof x !== "string" || !DATE.test(x)) return NaN;
  const t = Date.parse(x);
  return Number.isFinite(t) && new Date(t).toISOString() === x ? t : NaN;
};
const deny = blockers => ({
  status: blockers.length ? "DENIED" : "SIGNED_RELEASE_EVIDENCE_VALID_ONLY",
  project: PROJECT,
  signedReleaseEvidenceVerified: blockers.length === 0,
  signerRuntimeIdentityVerified: false,
  independentKeyCustodyVerified: false,
  ownerApprovalDbReadbackVerified: false,
  durableNonceConsumed: false,
  signatureIssued: false,
  signingPermitted: false,
  dispatchPermitted: false,
  finalAckIssued: false,
  releaseDecision: "NO_GO",
  blockers
});

/** Deterministic signature domain/field order; never accepts unknown claims. */
export function canonicalReleaseBytes(claims) {
  if(!exact(claims,CLAIM_KEYS))
    throw Error("SIGNER_RELEASE_CLAIMS_NOT_EXACT");
  return Buffer.from(DOMAIN + JSON.stringify(
    Object.fromEntries(CLAIM_KEYS.map(k => [k,claims[k]]))
  ),"utf8");
}

/**
 * Pure evidence review. trustedQaRoot and expected are caller-trusted ONLY
 * when loaded independently from protected custody/authoritative DB.
 * Do not expose a route that lets a request select those arguments.
 */
export function reviewCstDevDellSignerRelease({
  envelope, trustedQaRoot, expected, now = Date.now()
}) {
  const blockers=[], need=(ok,code)=>{if(!ok)blockers.push(code)};
  const claims=exact(envelope,["claims","signatureBase64"]) ?
    envelope.claims : null;
  need(!!claims,"RELEASE_ENVELOPE_SHAPE_INVALID");
  need(exact(claims,CLAIM_KEYS),"RELEASE_CLAIMS_SHAPE_INVALID");
  need(exact(trustedQaRoot,TRUST_KEYS),"QA_TRUST_SHAPE_INVALID");
  need(exact(expected,EXPECTED_KEYS),"INDEPENDENT_EXPECTED_FACTS_REQUIRED");

  let publicKey=null;
  try {
    if(!exact(trustedQaRoot,TRUST_KEYS) ||
      trustedQaRoot.use !== "CST_DEV_DELL_SIGNER_QA_PUBLIC_PIN" ||
      trustedQaRoot.project !== PROJECT ||
      !/^cst-independent-qa-[a-z0-9_-]{8,80}$/.test(trustedQaRoot.verifierId) ||
      !SHA64.test(trustedQaRoot.fingerprint)) throw Error("QA_ROOT_SCOPE");
    const key=createPublicKey(trustedQaRoot.publicKeyPem);
    if(key.asymmetricKeyType !== "ed25519" ||
      hash(key.export({type:"spki",format:"der"})) !== trustedQaRoot.fingerprint)
      throw Error("QA_ROOT_KEY_INVALID");
    publicKey=key;
  } catch {}
  need(!!publicKey,"INDEPENDENT_QA_ED25519_KEY_INVALID");
  need(exact(expected,EXPECTED_KEYS) &&
    expected.qaRootFingerprint === trustedQaRoot?.fingerprint &&
    SHA64.test(expected?.qaRootFingerprint||""),
    "QA_ROOT_NOT_INDEPENDENTLY_PINNED");

  if(exact(claims,CLAIM_KEYS)) {
    const c=claims;
    need(c.version===1 &&
      c.domain==="cst-onejob-dell-signer-release/v1" &&
      c.purpose==="CST_DEV_DELL_SIGNER_SINGLE_JOB" &&
      c.project===PROJECT && c.companyId==="1" &&
      Number.isSafeInteger(c.jobId) && c.jobId>482 &&
      ROLES.has(c.role) && WORKER.test(c.workerName||"") &&
      SHA40.test(c.sourceSha||"") && UUID.test(c.approvalId||"") &&
      UUID.test(c.eventId||"") && SHA64.test(c.payloadSha256||"") &&
      SID.test(c.signerSid||"") && SID.test(c.clientSid||"") &&
      c.signerSid !== c.clientSid && CHANGE.test(c.changeId||"") &&
      SHA64.test(c.nonce||"") &&
      c.verifierId===trustedQaRoot?.verifierId,
      "RELEASE_CLAIM_SCOPE_INVALID");
    need(exact(expected,EXPECTED_KEYS) && expected.project===PROJECT &&
      expected.companyId==="1" && expected.jobId===c.jobId &&
      expected.role===c.role && expected.workerName===c.workerName &&
      expected.sourceSha===c.sourceSha &&
      expected.approvalId===c.approvalId &&
      expected.eventId===c.eventId &&
      expected.payloadSha256===c.payloadSha256 &&
      expected.signerSid===c.signerSid && expected.clientSid===c.clientSid &&
      expected.changeId===c.changeId,
      "RELEASE_INDEPENDENT_FACTS_MISMATCH");
    const issued=millis(c.issuedAt),expires=millis(c.expiresAt);
    need(Number.isFinite(now) && Number.isFinite(issued) &&
      Number.isFinite(expires) && issued<=now && now<expires &&
      expires>issued && expires-issued<=300_000 &&
      now-issued<=300_000 && expires-now<=300_000,
      "RELEASE_TIME_INVALID");
  }
  let signatureVerified=false;
  if(publicKey && exact(claims,CLAIM_KEYS) &&
    typeof envelope.signatureBase64==="string" &&
    /^[a-zA-Z0-9+/]{86}==$/.test(envelope.signatureBase64)) {
    try {
      const sig=Buffer.from(envelope.signatureBase64,"base64");
      signatureVerified=sig.length===64 &&
        sig.toString("base64")===envelope.signatureBase64 &&
        verify(null,canonicalReleaseBytes(claims),publicKey,sig);
    } catch {}
  }
  need(signatureVerified,"INDEPENDENT_QA_RELEASE_SIGNATURE_INVALID");
  return deny(blockers);
}
