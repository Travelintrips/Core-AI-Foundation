import { describe,it,expect } from "vitest";
import { createHash } from "node:crypto";
import { verifyGpt02PrototypeManifest } from "../gpt02PrototypeManifestIntegrity.js";

const artifact=new TextEncoder().encode("<html><body>Recovered demo</body></html>");
const context={jobId:135,humanReviewId:6,commandId:"83db99f5-cbda-4e60-be71-3090fb411bbb"};
const manifest=()=>({
  ...context,filename:"index.html",artifactStage:"recovered_prototype_dev",
  bytes:artifact.length,sha256:createHash("sha256").update(artifact).digest("hex"),
  browserE2E:"SMOKE_PASS_ONLY",attestation:"NOT_VERIFIED",resumeAuthorized:false,
  browserEvidence:{realCameraStream:"NOT_TESTED",whatsapp:"NOT_TESTED",
    finalAttestation:"NOT_VERIFIED"},
});
describe("GPT02 recovered DEV artifact integrity is not operational approval",()=>{
  it("valid bytes verify as prototype only and NEVER dispatch",()=>{
    expect(verifyGpt02PrototypeManifest(manifest(),artifact,context)).toEqual({
      artifactIntegrityVerified:true,stage:"prototype_integrity_only",
      reason:"PROTOTYPE_BYTES_SHA256_MATCH_ONLY",
      operationalIntegrationVerified:false,attestationVerified:false,
      resumeAuthorized:false,mayCreateCommand:false,mayDispatchWorker:false,mayCloseJob:false,
    });
  });
  for(const [label,changed,reason] of [
    ["wrong job",{jobId:136},"SUBJECT_MISMATCH"],
    ["wrong human review",{humanReviewId:7},"SUBJECT_MISMATCH"],
    ["wrong command",{commandId:"different"},"SUBJECT_MISMATCH"],
    ["wrong file name",{filename:"camera.mp4"},"NOT_RECOVERED_DEV_PROTOTYPE"],
    ["wrong size",{bytes:0},"FILE_SIZE_MISMATCH"],
    ["fake hash",{sha256:"0".repeat(64)},"SHA256_MISMATCH"],
    ["fake attestation",{attestation:"VERIFIED"},"UNSUPPORTED_OPERATIONAL_CLAIM"],
    ["fake resume",{resumeAuthorized:true},"UNSUPPORTED_OPERATIONAL_CLAIM"],
    ["fake stream",{browserEvidence:{...manifest().browserEvidence,realCameraStream:"PASS"}},"UNSUPPORTED_OPERATIONAL_CLAIM"],
    ["fake WhatsApp",{browserEvidence:{...manifest().browserEvidence,whatsapp:"PASS"}},"UNSUPPORTED_OPERATIONAL_CLAIM"],
    ["fake final ACK",{browserEvidence:{...manifest().browserEvidence,finalAttestation:"VERIFIED"}},"UNSUPPORTED_OPERATIONAL_CLAIM"],
  ] as const){
    it("rejects "+label,()=>{
      const r=verifyGpt02PrototypeManifest({...manifest(),...changed},artifact,context);
      expect(r.reason).toBe(reason);
      expect(r.artifactIntegrityVerified).toBe(false);
      expect(r.mayDispatchWorker).toBe(false);
      expect(r.mayCloseJob).toBe(false);
    });
  }
});
