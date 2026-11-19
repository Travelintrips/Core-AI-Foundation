import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { nativeCheckpointAckPayload, verifyNativeCheckpointAckEvidence,
  type NativeCheckpointAckEvidence, type NativeCheckpointAckExpectation } from "../nativeCheckpointAckVerifier.js";
const now = new Date("2026-11-07T16:00:00.000Z");
const {privateKey,publicKey}=generateKeyPairSync("ed25519");
const pk=publicKey.export({format:"der",type:"spki"}).toString("base64");
const data=():NativeCheckpointAckEvidence=>({
  version:1, commandId:"169a7492-cfd8-4a56-bb57-18001b6b5968",
  responseId:"822efca2-7428-428a-ac66-548c0462438e", eventId:"a".repeat(64),
  conversationId:"ai-engine-oauth:"+"b".repeat(64),
  workerId:"openclaw-dell-chatgpt-wake-dev",browserProfile:"gpt02-dev",
  bindingFingerprint:"c".repeat(64), readerTargetId:"d".repeat(32),
  originalTargetId:"e".repeat(32),replySha256:"f".repeat(64),
  observedAt:new Date(now.getTime()-1000).toISOString(),signatureBase64:"",
});
function fixture(){const evidence=data();evidence.signatureBase64=sign(null,Buffer.from(nativeCheckpointAckPayload(evidence)),privateKey).toString("base64");
const expected:NativeCheckpointAckExpectation={...evidence,workerPublicKeyDerBase64:pk,checkpointCreatedAt:new Date(now.getTime()-3000),now,
  tokenOwner:evidence.workerId,devHost:true,browserObservationVerified:true};return {evidence,expected};}
describe("native GPT02 checkpoint ACK cryptographic gate",()=>{
  it("accepts correct signed browser receiver observation only",()=>{const {evidence,expected}=fixture();expect(verifyNativeCheckpointAckEvidence(evidence,expected)).toBe(true)});
  it.each(["commandId","responseId","eventId","conversationId","workerId","browserProfile","bindingFingerprint","readerTargetId","originalTargetId","replySha256"] as const)("rejects changed %s",field=>{
    const {evidence,expected}=fixture();expect(verifyNativeCheckpointAckEvidence({...evidence,[field]:field==="commandId"?"169a7492-cfd8-4a56-bb57-18001b6b5999":"0".repeat(evidence[field].length)},expected)).toBe(false)});
  it("rejects replay, future observation, or pre-checkpoint observation",()=>{const {evidence,expected}=fixture();
    expect(verifyNativeCheckpointAckEvidence(evidence,{...expected,now:new Date(now.getTime()+3600_000)})).toBe(false);
    expect(verifyNativeCheckpointAckEvidence(evidence,{...expected,checkpointCreatedAt:now})).toBe(false);
    expect(verifyNativeCheckpointAckEvidence({...evidence,observedAt:new Date(now.getTime()+60000).toISOString()},expected)).toBe(false);
  });
  it("rejects wrong worker credential, unverified UI, non-DEV and missing issuer key",()=>{const {evidence,expected}=fixture();
    for(const change of [{tokenOwner:"someone-else"},{browserObservationVerified:false},{devHost:false},{workerPublicKeyDerBase64:undefined}])
      expect(verifyNativeCheckpointAckEvidence(evidence,{...expected,...change})).toBe(false);
  });
  it("rejects malformed signature, duplicate tab identity and cross-key",()=>{const {evidence,expected}=fixture();
    expect(verifyNativeCheckpointAckEvidence({...evidence,signatureBase64:"bad"},expected)).toBe(false);
    expect(verifyNativeCheckpointAckEvidence({...evidence,readerTargetId:evidence.originalTargetId},expected)).toBe(false);
    const other=generateKeyPairSync("ed25519").publicKey.export({format:"der",type:"spki"}).toString("base64");
    expect(verifyNativeCheckpointAckEvidence(evidence,{...expected,workerPublicKeyDerBase64:other})).toBe(false);
  });
});
