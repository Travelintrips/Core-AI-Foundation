/**
 * Offline independent QA verification entrypoint.
 *
 * Separate process: no DB, HTTP server, worker credentials, signer, dispatch,
 * private key or persistent service. Reads a receipt, an expected-binding
 * manifest, and a separately pinned PUBLIC trust manifest from read-only files.
 * A PASS is cryptographic integrity only, never permission to queue or ACK.
 *
 * Usage (QA-only):
 * node --experimental-strip-types scripts/dev/cst-onejob-independent-qa-offline.mjs \
 *   receipt.json expected.json trusted-public.json
 */
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {reviewSignedIndependentQaReceipt} from
  "../../artifacts/api-server/src/lib/cstOneJobIndependentQaVerifier.ts";

function requireJson(path){
  const raw=readFileSync(resolve(path),"utf8");
  if(Buffer.byteLength(raw,"utf8")>16384)throw Error("QA_INPUT_TOO_LARGE");
  return JSON.parse(raw);
}
export function assessIndependentQaOffline(receipt,expected,trust){
  const deny=(reason)=>({status:"DENIED",reasons:[reason],
    queueTransitionAuthorized:false,dispatchPermitted:false,finalAckVerified:false});
  if(!trust || typeof trust!=="object" || Array.isArray(trust) ||
     trust.use!=="CST_DEV_ONEJOB_QA_PUBLIC_PIN" ||
     trust.project!=="xssrfshdrtdfupgqwfdw" ||
     trust.verifierId!==expected?.verifierId ||
     typeof trust.publicKeyPem!=="string" ||
     typeof trust.fingerprint!=="string"){
    return deny("PUBLIC_TRUST_MANIFEST_INVALID");
  }
  // Never accept a public key/fingerprint from the signed receipt itself
  // or from caller expected claims. Only a reviewed, pinned manifest can
  // supply them. A deployment must protect its integrity independently.
  if(expected && ("publicKeyPem" in expected || "trustedFingerprint" in expected))
    return deny("EXPECTED_CANNOT_OVERRIDE_TRUST_ROOT");
  if(expected?.project!=="xssrfshdrtdfupgqwfdw" ||
     !["PRE_ADMISSION","POST_EXECUTION"].includes(expected?.stage))
    return deny("EXPECTED_PROJECT_OR_STAGE_INVALID");
  const result=reviewSignedIndependentQaReceipt(receipt,{
    ...expected,publicKeyPem:trust.publicKeyPem,
    trustedFingerprint:trust.fingerprint
  });
  return {status:result.status,reasons:result.failures,
    bindingDigest:result.canonicalDigest ?? null,
    queueTransitionAuthorized:false,dispatchPermitted:false,
    finalAckVerified:false};
}
if(import.meta.url===`file://${process.argv[1]}`){
  if(process.argv.length!==5){
    console.log(JSON.stringify({status:"DENIED",reasons:["QA_INPUT_ARGUMENTS_INVALID"],
      queueTransitionAuthorized:false,dispatchPermitted:false,finalAckVerified:false}));
    process.exitCode=2;
  }else{
    try {
      const [receipt,expected,trust]=process.argv.slice(2).map(requireJson);
      const report=assessIndependentQaOffline(receipt,expected,trust);
      console.log(JSON.stringify(report));
      if(report.status!=="CRYPTOGRAPHIC_BINDING_VALID")process.exitCode=2;
    }catch{
      console.log(JSON.stringify({status:"DENIED",reasons:["QA_FILES_OR_PROOF_INVALID"],
        queueTransitionAuthorized:false,dispatchPermitted:false,finalAckVerified:false}));
      process.exitCode=2;
    }
  }
}
