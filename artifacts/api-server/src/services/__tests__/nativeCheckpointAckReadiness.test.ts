import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isPersistedNativeCheckpointAckVerified } from "../nativeCheckpointAckReadiness.js";
import { nativeCheckpointAckPayload, type NativeCheckpointAckEvidence } from "../nativeCheckpointAckVerifier.js";
const {privateKey,publicKey}=generateKeyPairSync("ed25519");
const pk=publicKey.export({type:"spki",format:"der"}).toString("base64");
const cmd="169a7492-cfd8-4a56-bb57-18001b6b5968",response="822efca2-7428-428a-ac66-548c0462438e";
const owner="ai-engine-oauth:"+"a".repeat(64),event="b".repeat(64),fp="c".repeat(64);
const worker="openclaw-dell-chatgpt-wake-dev",reply="SOP_CHECKPOINT PAUSED command 169a7492-cfd8-4a56-bb57-18001b6b5968";
function fixture(){
 const acknowledgedAt=new Date("2026-11-07T17:19:51.669Z");
 const evidence:NativeCheckpointAckEvidence={version:1,commandId:cmd,responseId:response,
  eventId:event,conversationId:owner,workerId:worker,browserProfile:"gpt02-dell-dev",
  bindingFingerprint:fp,readerTargetId:"d".repeat(32),originalTargetId:"e".repeat(32),
  replySha256:createHash("sha256").update(reply).digest("hex"),
  observedAt:new Date(acknowledgedAt.getTime()-1200).toISOString(),signatureBase64:""};
 evidence.signatureBase64=sign(null,Buffer.from(nativeCheckpointAckPayload(evidence)),privateKey).toString("base64");
 const commandMetadata={assignedClientId:worker,completedBy:worker,capability:"chatgpt:wake",
  devOnly:true,conversationId:owner,eventId:event,targetConversationId:"6ae4dd6b-a5f4-83ec-8fbc-dc9526e21a96",
  wakeBinding:{workerId:worker,ownerChannel:owner,targetConversationId:"6ae4dd6b-a5f4-83ec-8fbc-dc9526e21a96",browserProfile:"gpt02-dell-dev",bindingFingerprint:fp}};
 const responseMetadata={nativeCheckpointAckCode:"NATIVE_BROWSER_ACK_VERIFIED",
   nativeCheckpointAckResponseId:response,nativeCheckpointAckWorker:worker,
   nativeCheckpointAckEventId:event,nativeCheckpointAckObservedAt:evidence.observedAt,
   nativeCheckpointAckSignature:evidence.signatureBase64,nativeCheckpointAckEvidence:evidence};
 return {commandId:cmd,responseId:response,acknowledgedAt,
  checkpointCreatedAt:new Date(acknowledgedAt.getTime()-20000),responseMetadata,
  commandMetadata,failedReply:reply,issuerAttested:true,workerPublicKeyDerBase64:pk};
}
describe("native checkpoint receipt as passive lifecycle evidence",()=>{
 it("recognizes a signed persisted exact-command receiver ACK",()=>{
  expect(isPersistedNativeCheckpointAckVerified(fixture())).toBe(true);
 });
 it("rejects an ACK with no issuer attestation or no timestamp",()=>{
  expect(isPersistedNativeCheckpointAckVerified({...fixture(),issuerAttested:false})).toBe(false);
  expect(isPersistedNativeCheckpointAckVerified({...fixture(),acknowledgedAt:null})).toBe(false);
 });
 it("rejects cross-command, cross-response, or cross-reply replay",()=>{
  expect(isPersistedNativeCheckpointAckVerified({...fixture(),commandId:"00000000-0000-4000-8000-000000000000"})).toBe(false);
  expect(isPersistedNativeCheckpointAckVerified({...fixture(),responseId:"00000000-0000-4000-8000-000000000000"})).toBe(false);
  expect(isPersistedNativeCheckpointAckVerified({...fixture(),failedReply:"different failed reply"})).toBe(false);
 });
 it("rejects wrong worker, binding, or changed event",()=>{
  const x=fixture();
  expect(isPersistedNativeCheckpointAckVerified({...x,commandMetadata:{...x.commandMetadata,assignedClientId:"other"}})).toBe(false);
  expect(isPersistedNativeCheckpointAckVerified({...x,commandMetadata:{...x.commandMetadata,wakeBinding:{...x.commandMetadata.wakeBinding,bindingFingerprint:"f".repeat(64)}}})).toBe(false);
  expect(isPersistedNativeCheckpointAckVerified({...x,responseMetadata:{...x.responseMetadata,nativeCheckpointAckEventId:"f".repeat(64)}})).toBe(false);
 });
 it("rejects forged stored signature, label alone, and invalid worker key",()=>{
  const x=fixture();
  expect(isPersistedNativeCheckpointAckVerified({...x,responseMetadata:{nativeCheckpointAckCode:"NATIVE_BROWSER_ACK_VERIFIED"}})).toBe(false);
  expect(isPersistedNativeCheckpointAckVerified({...x,responseMetadata:{...x.responseMetadata,nativeCheckpointAckSignature:"forged"}})).toBe(false);
  expect(isPersistedNativeCheckpointAckVerified({...x,workerPublicKeyDerBase64:generateKeyPairSync("ed25519").publicKey.export({type:"spki",format:"der"}).toString("base64")})).toBe(false);
 });
 it("rejects receipt observation outside original checkpoint validity",()=>{
  const x=fixture();
  expect(isPersistedNativeCheckpointAckVerified({...x,checkpointCreatedAt:new Date(x.acknowledgedAt.getTime()+1000)})).toBe(false);
  expect(isPersistedNativeCheckpointAckVerified({...x,acknowledgedAt:new Date(x.acknowledgedAt.getTime()+900000)})).toBe(false);
 });
});
