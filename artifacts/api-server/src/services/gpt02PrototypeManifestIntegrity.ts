/**
 * Verify recovered prototype bytes against a DEV evidence manifest.
 * File integrity does NOT prove execution attestation, real CCTV streams,
 * WhatsApp delivery, a signed checkpoint or authorization to dispatch.
 * Pure/read-only: never updates jobs or commands.
 */
import { createHash } from "node:crypto";

type Context = { jobId: number; humanReviewId: number; commandId: string };
export type PrototypeIntegrityResult = {
  artifactIntegrityVerified: boolean;
  stage: "prototype_integrity_only" | "unverified";
  reason: string;
  operationalIntegrationVerified: false;
  attestationVerified: false;
  resumeAuthorized: false;
  mayCreateCommand: false;
  mayDispatchWorker: false;
  mayCloseJob: false;
};

function fail(reason: string): PrototypeIntegrityResult {
  return {
    artifactIntegrityVerified: false, stage: "unverified", reason,
    operationalIntegrationVerified:false,attestationVerified:false,
    resumeAuthorized:false,mayCreateCommand:false,
    mayDispatchWorker:false,mayCloseJob:false,
  };
}
function record(x:unknown): x is Record<string,unknown> {
  return x!==null && typeof x==="object" && !Array.isArray(x);
}

export function verifyGpt02PrototypeManifest(
  manifest: unknown, artifact: Uint8Array, expected: Context,
): PrototypeIntegrityResult {
  if(!record(manifest) || !Number.isSafeInteger(expected.jobId) ||
    !Number.isSafeInteger(expected.humanReviewId) || !expected.commandId)
    return fail("INVALID_MANIFEST_OR_BINDING");
  if(manifest.jobId!==expected.jobId || manifest.humanReviewId!==expected.humanReviewId ||
    manifest.commandId!==expected.commandId)
    return fail("SUBJECT_MISMATCH");
  if(manifest.filename!=="index.html" ||
    manifest.artifactStage!=="recovered_prototype_dev")
    return fail("NOT_RECOVERED_DEV_PROTOTYPE");
  if(artifact.byteLength===0 || artifact.byteLength>10*1024*1024 ||
    manifest.bytes!==artifact.byteLength)
    return fail("FILE_SIZE_MISMATCH");
  if(typeof manifest.sha256!=="string" || !/^[a-f0-9]{64}$/.test(manifest.sha256))
    return fail("INVALID_SHA256");
  const actual=createHash("sha256").update(artifact).digest("hex");
  if(actual!==manifest.sha256)return fail("SHA256_MISMATCH");
  // A prototype is never a signed lifecycle checkpoint. Reject any manifest
  // that purports to provide an operational attestation or resume grant.
  if(manifest.attestation!=="NOT_VERIFIED" || manifest.resumeAuthorized!==false ||
    manifest.browserE2E!=="SMOKE_PASS_ONLY" ||
    !record(manifest.browserEvidence) ||
    manifest.browserEvidence.realCameraStream!=="NOT_TESTED" ||
    manifest.browserEvidence.whatsapp!=="NOT_TESTED" ||
    manifest.browserEvidence.finalAttestation!=="NOT_VERIFIED")
    return fail("UNSUPPORTED_OPERATIONAL_CLAIM");
  return {
    artifactIntegrityVerified:true,stage:"prototype_integrity_only",
    reason:"PROTOTYPE_BYTES_SHA256_MATCH_ONLY",
    operationalIntegrationVerified:false,attestationVerified:false,
    resumeAuthorized:false,mayCreateCommand:false,mayDispatchWorker:false,mayCloseJob:false,
  };
}
