#!/usr/bin/env node
/**
 * Independent QA (PRE_ADMISSION or POST_EXECUTION) one-shot source candidate.
 * Default OFF: no approved release, identity, externally captured source
 * evidence, or separate signer means NO WORK. Never dispatches or issues ACK.
 */
import {readRootOwnedQaPublicTrust}
  from "./cst-onejob-qa-trust-custody.mjs";
import {persistIndependentPreAdmission,signIndependentQaEvidence}
  from "./cst-onejob-independent-evidence-issuers.mjs";
import {
  PROJECT,sha256,reviewIndependentIssuerEnvironment,
  reviewIndependentIssuerRelease,readRootCustodiedJson,
  readRootCustodiedFile,openDedicatedIssuerClient,independentlySign,
  nonRootAuthorizedOperator
} from "./cst-onejob-independent-issuer-custody.mjs";

const RELEASE="/etc/cst-onejob-qa/approval/qa-release.json";
const PRE="/var/lib/cst-onejob-qa/pre-admission/evidence.bin";
const POST="/var/lib/cst-onejob-qa/post-execution/evidence.bin";
const BINDING="/var/lib/cst-onejob-qa/post-execution/binding.json";
const SOCKET="/run/cst-onejob-qa/sign.sock";
const SECRET="CST_DEV_ONEJOB_QA_DATABASE_URL";
const FLAG="CST_DEV_ONEJOB_INDEPENDENT_QA_ENABLED";
const PURPOSE="CST_DEV_ONEJOB_INDEPENDENT_QA";
const LOGIN="cst_onejob_qa_receipt_login";
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const DIGEST=/^sha256:[a-f0-9]{64}$/;

export function reviewQaBoundCapture(stage,jobId,release,evidence,binding){
  const blockers=[],need=(ok,code)=>{if(!ok)blockers.push(code)};
  let parsed=null;
  try{parsed=JSON.parse(evidence.toString("utf8"))}catch{}
  need(Buffer.isBuffer(evidence)&&evidence.length>0&&evidence.length<=65536,
    "QA_CAPTURE_BYTES_INVALID");
  // PRE and POST have different exact evidence contracts. POST's source
  // bytes contain the 5 persisted event/delivery fields, no project field.
  need(parsed&&parsed.jobId===jobId&&
    (stage==="POST_EXECUTION"||parsed.project===PROJECT),
    "QA_CAPTURE_SCOPE_INVALID");
  if(stage==="PRE_ADMISSION"){
    need(parsed?.scope==="CST_DEV_ONEJOB_PRE_ADMISSION"&&
      parsed.sourceSha===release.sourceSha&&
      parsed.workerName===release.workerName&&
      DIGEST.test(parsed.imageId||"")&&UUID.test(parsed.approvalId||"")&&
      parsed.checks?.isolatedNetwork===true&&
      parsed.checks?.scopedDevRole===true&&
      parsed.checks?.eventAuditPath===true&&
      parsed.checks?.subscriberPath===true&&
      parsed.checks?.independentQaAvailable===true,
      "PRE_QA_CAPTURE_NOT_BOUND");
  } else {
    need(binding?.project===PROJECT&&binding?.companyId==="1"&&
      binding.jobId===jobId&&binding.workerName===release.workerName&&
      binding.sourceSha===release.sourceSha&&
      UUID.test(binding.approvalId||"")&&DIGEST.test(binding.imageId||"")&&
      binding.postBinding?.eventId===parsed?.eventId&&
      binding.postBinding?.deliveryId===parsed?.deliveryId&&
      binding.postBinding?.subscriberId===parsed?.subscriberId,
      "POST_QA_BINDING_UNVERIFIED");
  }
  need(sha256(evidence)===release.evidenceSha256,"QA_CAPTURE_RELEASE_HASH_MISMATCH");
  return {ready:blockers.length===0,blockers,releaseDecision:"NO_GO",
    finalAckIssued:false,dispatchPermitted:false};
}

export async function main(args=process.argv.slice(2),env=process.env){
  const denied=(reason,blockers=[])=>({status:"DENIED",reason,blockers,
    project:PROJECT,releaseDecision:"NO_GO",dispatchPermitted:false,
    queueTransitionAuthorized:false,finalAckIssued:false});
  if(args.length!==2||!["--pre-admission","--post-execution"].includes(args[0])||
     !/^[1-9]\d{0,9}$/.test(args[1]))
    return denied("EXPLICIT_QA_ONE_SHOT_MODE_REQUIRED");
  const jobId=Number(args[1]),stage=args[0]==="--pre-admission"?
    "PRE_ADMISSION":"POST_EXECUTION";
  // POST signing must not need or receive the PRE-only DB credential.
  const gate=reviewIndependentIssuerEnvironment(env,jobId,PURPOSE,SECRET,FLAG,
    stage==="PRE_ADMISSION");
  if(!gate.ready)return denied("QA_PROVISIONING_NOT_AUTHORIZED",gate.blockers);
  if(typeof process.getuid!=="function"||process.getuid()===0)
    return denied("ROOT_OR_NONLINUX_OPERATOR_FORBIDDEN");
  try{
    // This QA signature must come from an independent custody host/process;
    // being able to read a manifest is not proof that QA ran independently.
    const release=readRootCustodiedJson(RELEASE);
    const {document:trust}=readRootOwnedQaPublicTrust();
    const evidence=readRootCustodiedFile(stage==="PRE_ADMISSION"?PRE:POST);
    const scope={
      purpose:PURPOSE,jobId,
      sourceSha:env.CST_TEAM_DEV_APPROVED_SOURCE_SHA,
      workerName:env.CST_TEAM_DEV_APPROVED_WORKER_NAME,
      signerId:trust.verifierId,
      trustUse:"CST_DEV_ONEJOB_QA_PUBLIC_PIN",
      evidenceSha256:sha256(evidence)
    };
    const checked=reviewIndependentIssuerRelease(release,trust,scope);
    if(!checked.ready)return denied("INDEPENDENT_QA_RELEASE_UNVERIFIED",checked.blockers);
    if(!nonRootAuthorizedOperator(release))
      return denied("QA_OPERATOR_UID_NOT_AUTHORIZED");
    const binding=stage==="POST_EXECUTION"?readRootCustodiedJson(BINDING):null;
    const capture=reviewQaBoundCapture(stage,jobId,release,evidence,binding);
    if(!capture.ready)return denied("INDEPENDENT_QA_CAPTURE_UNVERIFIED",capture.blockers);
    const signBytes=bytes=>independentlySign(bytes,release.signerUid,SOCKET);
    if(stage==="PRE_ADMISSION"){
      // No source-provided approval or job may substitute DB readback.
      // Existing QA writer does one SERIALIZABLE transaction and rollback.
      const client=await openDedicatedIssuerClient(env[SECRET],LOGIN,
        "cst-dev-onejob-independent-qa-pre");
      try{
        const output=await persistIndependentPreAdmission({
          client,jobId,imageId:JSON.parse(evidence.toString("utf8")).imageId,
          evidenceBytes:evidence,pinnedTrust:trust,signBytes
        });
        // Match release before returning a receipt to the broker. The
        // signed evidence itself already checks this inside the transaction.
        if(output.signedReceipt.claims.sourceSha!==release.sourceSha||
           output.signedReceipt.claims.workerName!==release.workerName)
          return denied("QA_RELEASE_AND_DB_MISMATCH");
        return {status:"QA_PRE_RECEIPT_PERSISTED_NOT_ADMITTED",
          project:PROJECT,jobId,receiptId:output.receiptId,
          signedReceipt:output.signedReceipt,releaseDecision:"NO_GO",
          dispatchPermitted:false,queueTransitionAuthorized:false,
          finalAckIssued:false};
      }finally{await client.end().catch(()=>{})}
    }
    // POST signs independently captured and root-custodied bytes only.
    // It does NOT write a Core reconciliation or issue Hub Final ACK.
    const output=await signIndependentQaEvidence({
      stage,binding,evidenceBytes:evidence,pinnedTrust:trust,signBytes
    });
    return {status:"QA_POST_SIGNED_ONLY_NOT_FINAL_ACK",project:PROJECT,jobId,
      signedReceipt:output.signedReceipt,releaseDecision:"NO_GO",
      dispatchPermitted:false,queueTransitionAuthorized:false,
      finalAckIssued:false};
  }catch{
    return denied("INDEPENDENT_QA_CUSTODY_OR_IDENTITY_UNAVAILABLE");
  }
}
if(import.meta.url===`file://${process.argv[1]}`){
  const result=await main();
  process.stdout.write(JSON.stringify(result)+"\n");
  if(!["QA_PRE_RECEIPT_PERSISTED_NOT_ADMITTED",
        "QA_POST_SIGNED_ONLY_NOT_FINAL_ACK"].includes(result.status))
    process.exitCode=2;
}
