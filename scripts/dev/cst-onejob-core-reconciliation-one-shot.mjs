#!/usr/bin/env node
/**
 * Independently operated Core reconciliation one-shot (NOT Hub Final ACK).
 * Source candidate, default DENY, single Company-1 job and event only.
 * No service identity/key issuance, database migration or shared Core fallback.
 */
import {readRootCustodiedJson,readRootCustodiedFile,sha256,
  reviewIndependentIssuerEnvironment,reviewIndependentIssuerRelease,
  openDedicatedIssuerClient,independentlySign,nonRootAuthorizedOperator,PROJECT}
  from "./cst-onejob-independent-issuer-custody.mjs";
import {executeCoreReconciliationCandidate}
  from "./cst-onejob-final-ack-candidate.mjs";

const RELEASE="/etc/cst-onejob-qa/approval/core-reconciliation-release.json";
const TRUST="/etc/cst-onejob-core-reconciliation/trust/public-root.json";
const QA_TRUST="/etc/cst-onejob-qa/trust/public-root.json";
const SUB_TRUST="/etc/cst-onejob-subscriber/trust/public-root.json";
const PACKAGE="/var/lib/cst-onejob-core-reconciliation/evidence/package.json";
const SOCKET="/run/cst-onejob-core-reconciliation/sign.sock";
const DB_KEY="CST_DEV_ONEJOB_RECONCILIATION_DATABASE_URL";
const FLAG="CST_DEV_ONEJOB_CORE_RECONCILIATION_ENABLED";
const PURPOSE="CST_DEV_ONEJOB_CORE_RECONCILIATION";
const LOGIN="cst_onejob_finalack_login";
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SUB=/^cst-onejob-subscriber-[a-z0-9_-]{4,64}$/;
const expectedFields=["jobId","eventId","sourceSha","expectedSubscriberId",
 "signedSubscriberAck","signedPostReceipt","deliveryBase64",
 "qaEvidenceBase64","responseBase64"];
const exact=(v,keys)=>v&&typeof v==="object"&&!Array.isArray(v)&&
  Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const canonicalBase64=text=>{
  if(typeof text!=="string"||text.length<4||text.length>100000)return null;
  try{
    const bytes=Buffer.from(text,"base64");
    return bytes.toString("base64")===text?bytes:null;
  }catch{return null}
};

export function reviewCoreReconciliationPackage(pkg,release,trusts,jobId,eventId,raw){
  const blockers=[],need=(ok,code)=>{if(!ok)blockers.push(code)};
  need(exact(pkg,expectedFields),"CORE_PACKAGE_SHAPE_INVALID");
  need(Number.isSafeInteger(jobId)&&jobId>482&&pkg?.jobId===jobId&&
    UUID.test(eventId||"")&&pkg?.eventId===eventId,
    "ONE_JOB_EVENT_BINDING_INVALID");
  need(pkg?.sourceSha===release?.sourceSha&&
    pkg?.sourceSha===pkg?.signedPostReceipt?.claims?.sourceSha,
    "APPROVED_SOURCE_NOT_BOUND_TO_POST_QA");
  need(SUB.test(pkg?.expectedSubscriberId||"")&&
    pkg?.expectedSubscriberId===trusts?.subscriber?.subscriberId&&
    pkg?.signedSubscriberAck?.claims?.subscriberId===pkg?.expectedSubscriberId&&
    pkg?.signedPostReceipt?.claims?.jobId===jobId&&
    pkg?.signedSubscriberAck?.claims?.jobId===jobId&&
    pkg?.signedSubscriberAck?.claims?.eventId===eventId,
    "INDEPENDENT_RECEIPT_LINEAGE_INVALID");
  const bytes={
    delivery:canonicalBase64(pkg?.deliveryBase64),
    qaEvidence:canonicalBase64(pkg?.qaEvidenceBase64),
    response:canonicalBase64(pkg?.responseBase64),
  };
  need(bytes.delivery&&bytes.delivery.length<=65536&&
    bytes.qaEvidence&&bytes.qaEvidence.length<=65536&&
    bytes.response&&bytes.response.length<=2048&&
    bytes.response.toString("utf8")==="CST_DEV_ONEJOB_PROBE_OK",
    "INDEPENDENT_CAPTURE_BYTES_INVALID");
  need(Buffer.isBuffer(raw)&&raw.length<=65536&&
    sha256(raw)===release?.evidenceSha256,"PACKAGE_DIGEST_NOT_PINNED");
  return {ready:blockers.length===0,blockers,bytes,
    releaseDecision:"NO_GO",independentFinalAckVerified:false,finalAckIssued:false};
}

export async function main(args=process.argv.slice(2),env=process.env){
  const denied=(reason,blockers=[])=>({status:"DENIED",reason,blockers,
    project:PROJECT,releaseDecision:"NO_GO",dispatchPermitted:false,
    finalAckIssued:false,independentFinalAckVerified:false});
  if(args.length!==3||args[0]!=="--reconcile-approved-dev"||
     !/^[1-9]\d{0,9}$/.test(args[1])||!UUID.test(args[2]))
    return denied("EXPLICIT_CORE_RECONCILIATION_INVOCATION_REQUIRED");
  const jobId=Number(args[1]),eventId=args[2];
  const gate=reviewIndependentIssuerEnvironment(env,jobId,PURPOSE,DB_KEY,FLAG);
  if(!gate.ready)return denied("CORE_RECONCILIATION_NOT_PROVISIONED",gate.blockers);
  if(typeof process.getuid!=="function"||process.getuid()===0)
    return denied("INDEPENDENT_NONROOT_OPERATOR_REQUIRED");
  try{
    const release=readRootCustodiedJson(RELEASE);
    const issuerTrust=readRootCustodiedJson(TRUST);
    const qaTrust=readRootCustodiedJson(QA_TRUST);
    const subscriberTrust=readRootCustodiedJson(SUB_TRUST);
    const raw=readRootCustodiedFile(PACKAGE,65536);
    const pkg=JSON.parse(raw.toString("utf8"));
    const scope={
      purpose:PURPOSE,jobId,
      sourceSha:env.CST_TEAM_DEV_APPROVED_SOURCE_SHA,
      workerName:env.CST_TEAM_DEV_APPROVED_WORKER_NAME,
      signerId:issuerTrust.issuerId,
      trustUse:"CST_DEV_ONEJOB_CORE_RECONCILIATION_PUBLIC_PIN",
      evidenceSha256:sha256(raw),
    };
    const releaseCheck=reviewIndependentIssuerRelease(release,issuerTrust,scope);
    if(!releaseCheck.ready)return denied("CORE_RELEASE_OR_SIGNER_NOT_AUTHORIZED",releaseCheck.blockers);
    if(!nonRootAuthorizedOperator(release))
      return denied("INDEPENDENT_RECONCILIATION_OPERATOR_NOT_BOUND");
    if(qaTrust?.project!==PROJECT||
       qaTrust?.use!=="CST_DEV_ONEJOB_QA_PUBLIC_PIN"||
       subscriberTrust?.project!==PROJECT||
       subscriberTrust?.use!=="CST_DEV_ONEJOB_SUBSCRIBER_PUBLIC_PIN"||
       qaTrust.fingerprint===subscriberTrust.fingerprint||
       issuerTrust.fingerprint===qaTrust.fingerprint||
       issuerTrust.fingerprint===subscriberTrust.fingerprint)
      return denied("THREE_INDEPENDENT_SIGNER_ROOTS_REQUIRED");
    const checked=reviewCoreReconciliationPackage(pkg,release,
      {qa:qaTrust,subscriber:subscriberTrust},jobId,eventId,raw);
    if(!checked.ready)return denied("CORE_PACKAGE_UNTRUSTED",checked.blockers);
    const client=await openDedicatedIssuerClient(env[DB_KEY],LOGIN,
      "cst-dev-onejob-core-reconciliation");
    try{
      const out=await executeCoreReconciliationCandidate({
        client,jobId,eventId,
        signedSubscriberAck:pkg.signedSubscriberAck,
        subscriberTrust,deliveryBytes:checked.bytes.delivery,
        signedPostReceipt:pkg.signedPostReceipt,
        qaTrust,evidenceBytes:checked.bytes.qaEvidence,
        responseBytes:checked.bytes.response,
        expectedSubscriberId:pkg.expectedSubscriberId,
        signer:bytes=>independentlySign(bytes,release.signerUid,SOCKET),
        finalIssuerTrust:issuerTrust
      });
      return {status:"CORE_RECONCILIATION_COMMITTED_NOT_FINAL_ACK",
        project:PROJECT,jobId,reconciliationId:out.reconciliationId,
        releaseDecision:"NO_GO",dispatchPermitted:false,
        fourAgentQuorumVerified:false,finalAckIssued:false,
        independentFinalAckVerified:false};
    }finally{await client.end().catch(()=>{})}
  }catch{
    return denied("INDEPENDENT_CORE_CUSTODY_OR_DATABASE_NOT_AVAILABLE");
  }
}
if(import.meta.url===`file://${process.argv[1]}`){
  const result=await main();
  process.stdout.write(JSON.stringify(result)+"\n");
  if(result.status!=="CORE_RECONCILIATION_COMMITTED_NOT_FINAL_ACK")
    process.exitCode=2;
}
