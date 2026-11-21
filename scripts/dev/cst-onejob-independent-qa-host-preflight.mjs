/**
 * Operational-shaped Independent QA preflight, NOT operational approval.
 * The only input files are signed receipt and expected binding. The public
 * trust root is loaded from a fixed root-owned /etc path, never from argv.
 * No cryptographic private key, DB access, signer, worker, or dispatch.
 */
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {readRootOwnedQaPublicTrust,CST_QA_PINNED_TRUST_PATH}
  from "./cst-onejob-qa-trust-custody.mjs";
import {assessIndependentQaOffline}
  from "./cst-onejob-independent-qa-offline.mjs";

function readUntrustedJson(path) {
  const data=readFileSync(resolve(path),"utf8");
  if(Buffer.byteLength(data,"utf8")>16384)throw Error("QA_INPUT_TOO_LARGE");
  return JSON.parse(data);
}
export function reviewQaHostPreflight(receipt,expected,trust){
  // The caller MUST have obtained trust from readRootOwnedQaPublicTrust().
  // This is only a review function; it grants no queue or ACK authority.
  return assessIndependentQaOffline(receipt,expected,trust);
}
if(import.meta.url===`file://${process.argv[1]}`) {
  if(process.argv.length!==4) {
    console.log(JSON.stringify({status:"DENIED",
      reasons:["EXACT_TWO_INPUTS_REQUIRED_TRUST_PIN_IS_FIXED"],
      trustPath:CST_QA_PINNED_TRUST_PATH,dispatchPermitted:false,
      queueTransitionAuthorized:false,finalAckVerified:false}));
    process.exitCode=2;
  } else {
    try {
      const [receipt,expected]=process.argv.slice(2).map(readUntrustedJson);
      const {document}=readRootOwnedQaPublicTrust();
      const result=reviewQaHostPreflight(receipt,expected,document);
      console.log(JSON.stringify({...result,trustPath:CST_QA_PINNED_TRUST_PATH}));
      if(result.status!=="CRYPTOGRAPHIC_BINDING_VALID")process.exitCode=2;
    }catch {
      console.log(JSON.stringify({status:"DENIED",
        reasons:["HOST_QA_TRUST_OR_INPUT_UNAVAILABLE"],
        trustPath:CST_QA_PINNED_TRUST_PATH,
        dispatchPermitted:false,queueTransitionAuthorized:false,
        finalAckVerified:false}));
      process.exitCode=2;
    }
  }
}
