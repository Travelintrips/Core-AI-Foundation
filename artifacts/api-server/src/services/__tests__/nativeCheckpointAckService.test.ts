import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { nativeCheckpointAckPayload, type NativeCheckpointAckEvidence } from "../nativeCheckpointAckVerifier.js";
const mocks=vi.hoisted(()=>({ executed:[] as Array<{ rows: unknown[] }>,calls:0, directRows:[] as unknown[], issuerPass:true,publicKey:"" }));
vi.mock("@workspace/db",()=>({db:{execute:async()=>({rows:mocks.directRows}), transaction:async(fn:(tx:{execute:()=>Promise<unknown>})=>Promise<unknown>)=>fn({execute:async()=>{mocks.calls++;return mocks.executed.shift()??{rows:[]}}})}}));
vi.mock("../devSopCheckpointIssuer.js",()=>({verifyDevSopCheckpointReceipt:()=>mocks.issuerPass}));
vi.mock("../devAssistantAttestation.js",()=>({devAssistantPublicKeyForWorker:()=>mocks.publicKey}));
import { acknowledgeNativeCheckpoint, readNativeCheckpointAck } from "../nativeCheckpointAckService.js";
const keys=generateKeyPairSync("ed25519");
const now=new Date();
const conv="6ae4dd6b-a5f4-83ec-8fbc-dc9526e21a96",owner="ai-engine-oauth:"+"a".repeat(64);
const commandId="169a7492-cfd8-4a56-bb57-18001b6b5968",responseId="822efca2-7428-428a-ac66-548c0462438e";
const event="b".repeat(64),fp="c".repeat(64),original="d".repeat(32),reader="e".repeat(32);
const message='<escape>{"kind":"SOP_CHECKPOINT","status":"PAUSED"}</escape>';
function fixture(){
 const evidence:NativeCheckpointAckEvidence={version:1,commandId,responseId,eventId:event,conversationId:owner,
  workerId:"openclaw-dell-chatgpt-wake-dev",browserProfile:"gpt02-dev",bindingFingerprint:fp,
  readerTargetId:reader,originalTargetId:original,replySha256:createHash("sha256").update(message).digest("hex"),
  observedAt:new Date().toISOString(),signatureBase64:""};
 evidence.signatureBase64=sign(null,Buffer.from(nativeCheckpointAckPayload(evidence)),keys.privateKey).toString("base64");
 const readerRecord={eventId:event,conversationId:conv,originalRawTargetId:original,readerRawTargetId:reader,
  pageUrl:`https://chatgpt.com/c/${conv}`,preopenTargetIds:[original],status:"CAPTURE_VERIFIED",
  disposition:"PRESERVED_RECONCILIATION_REQUIRED",originalFocusRestored:true,capturedAt:1794061591};
 const tabs=[{id:original,url:`https://chatgpt.com/c/${conv}`,type:"page"},
  {id:reader,url:`https://chatgpt.com/c/${conv}`,type:"page"}];
 const row={command_id:commandId,response_id:responseId,kind:"CHECKPOINT",status:"FAILED",acknowledged_at:null,
  command_metadata:{assignedClientId:evidence.workerId,completedBy:evidence.workerId,capability:"chatgpt:wake",devOnly:true,
    conversationId:owner,targetConversationId:conv,eventId:event,wakeBinding:{browserProfile:"gpt02-dev",bindingFingerprint:fp}},
  response_metadata:{},checkpoint_json:{},native_reply:message,
  checkpoint_created_at:new Date(Date.now()-1500).toISOString()};
 const req={commandId,responseId,tokenOwner:evidence.workerId,evidence,readerRecord,tabs,
   requestHostname:"dev.cstlogistic.co.id",enabled:true};
 return {req,row};
}
beforeEach(()=>{mocks.calls=0;mocks.executed=[];mocks.directRows=[];mocks.issuerPass=true;
 mocks.publicKey=keys.publicKey.export({format:"der",type:"spki"}).toString("base64")});
describe("DEV native checkpoint ACK admission and atomic update",()=>{
 it("fails closed without flag, DEV hostname or owner worker, without reading database",async()=>{
  const {req}=fixture();
  for(const patch of [{enabled:false},{requestHostname:"sc.travelintrips.co.id"},
    {tokenOwner:"openclaw-unrelated"},{responseId:"22222222-2222-4222-8222-222222222222"}])
    expect((await acknowledgeNativeCheckpoint({...req,...patch})).acknowledged).toBe(false);
  expect(mocks.calls).toBe(0);
 });
 it("accepts exactly signed, verified, uniquely-owned checkpoint once",async()=>{
  const {req,row}=fixture();mocks.executed=[{rows:[row]},{rows:[{id:responseId}]},{rows:[]}];
  expect(await acknowledgeNativeCheckpoint(req)).toEqual({acknowledged:true,code:"NATIVE_BROWSER_ACK_VERIFIED"});
  expect(mocks.calls).toBe(3);
 });
 it("never rewrites a previously ACKed response",async()=>{
  const {req,row}=fixture();mocks.executed=[{rows:[{...row,acknowledged_at:new Date().toISOString()}]}];
  expect((await acknowledgeNativeCheckpoint(req)).acknowledged).toBe(false);
  expect(mocks.calls).toBe(1);
 });
 it("rejects missing original reader tab, unknown issuer and tampered signature with no writes",async()=>{
  for(const which of ["missing-tab","invalid-issuer","bad-signature"]){
   const {req,row}=fixture();if(which==="missing-tab")req.tabs=req.tabs.slice(1);
   if(which==="invalid-issuer")mocks.issuerPass=false;
   if(which==="bad-signature")req.evidence.signatureBase64="bad";
   mocks.executed=[{rows:[row]}];mocks.calls=0;
   expect((await acknowledgeNativeCheckpoint(req)).acknowledged).toBe(false);
   expect(mocks.calls).toBe(1);mocks.issuerPass=true;
  }
 });
 it("readback rejects missing ACK, wrong worker and invalid signature",async()=>{
  const {req,row}=fixture();
  expect((await readNativeCheckpointAck({commandId,responseId,tokenOwner:req.tokenOwner,requestHostname:req.requestHostname})).nativeAckVerified).toBe(false);
  mocks.directRows=[{...row,acknowledged_at:new Date().toISOString(),created_at:row.checkpoint_created_at,
    command_metadata:{...row.command_metadata,nativeCheckpointAckResponseId:responseId,
      nativeCheckpointAckWorker:req.tokenOwner,nativeCheckpointAckEventId:event,
      nativeCheckpointAckCode:"NATIVE_BROWSER_ACK_VERIFIED",
      nativeCheckpointAckEvidence:{...req.evidence,signatureBase64:"forged"}}}];
  expect((await readNativeCheckpointAck({commandId,responseId,tokenOwner:req.tokenOwner,requestHostname:req.requestHostname})).nativeAckVerified).toBe(false);
  expect((await readNativeCheckpointAck({commandId,responseId,tokenOwner:"other",requestHostname:req.requestHostname})).nativeAckVerified).toBe(false);
 });
 it("rejects cross-worker and non-DEV command metadata",async()=>{
  for(const patch of [{assignedClientId:"other"},{devOnly:false},{capability:"unknown"}]){
   const {req,row}=fixture();mocks.executed=[{rows:[{...row,command_metadata:{...row.command_metadata,...patch}}]}];mocks.calls=0;
   expect((await acknowledgeNativeCheckpoint(req)).acknowledged).toBe(false);
   expect(mocks.calls).toBe(1);
  }
 });
});
