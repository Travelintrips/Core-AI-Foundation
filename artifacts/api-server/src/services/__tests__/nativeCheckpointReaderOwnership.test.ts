import { describe, expect, it } from "vitest";
import { verifyNativeCheckpointReaderOwnership, type NativeReaderRecord } from "../nativeCheckpointReaderOwnership.js";
const original="a".repeat(32),reader="b".repeat(32),event="c".repeat(64),conversation="6ae4dd6b-a5f4-83ec-8fbc-dc9526e21a96",pageUrl=`https://chatgpt.com/c/${conversation}`;
const record=():NativeReaderRecord=>({eventId:event,conversationId:conversation,originalRawTargetId:original,readerRawTargetId:reader,pageUrl,
  preopenTargetIds:[original],status:"CAPTURE_VERIFIED",disposition:"PRESERVED_RECONCILIATION_REQUIRED",
  originalFocusRestored:true,capturedAt:1794061591.58});
const tabs=()=>[{type:"page",id:original,url:pageUrl},{type:"page",id:reader,url:pageUrl}];
const input=()=>({record:record(),expectedEventId:event,expectedConversationId:conversation,expectedReaderId:reader,expectedOriginalId:original,tabs:tabs()});
describe("native GPT02 reader ownership",()=>{
 it("accepts exact two-tab receipt only",()=>expect(verifyNativeCheckpointReaderOwnership(input())).toBe(true));
 it("rejects missing original and third duplicate tab",()=>{
  expect(verifyNativeCheckpointReaderOwnership({...input(),tabs:[tabs()[1]]})).toBe(false);
  expect(verifyNativeCheckpointReaderOwnership({...input(),tabs:[...tabs(),{type:"page",url:pageUrl,id:"d".repeat(32)}]})).toBe(false);
 });
 it("rejects mismatched events and target IDs",()=>{
  expect(verifyNativeCheckpointReaderOwnership({...input(),expectedEventId:"d".repeat(64)})).toBe(false);
  expect(verifyNativeCheckpointReaderOwnership({...input(),expectedReaderId:original})).toBe(false);
  expect(verifyNativeCheckpointReaderOwnership({...input(),expectedConversationId:"e".repeat(36)})).toBe(false);
 });
 it("rejects unverified, altered, or prematurely closed receipts",()=>{
  for(const patch of [{status:"UNVERIFIED"},{disposition:"CLOSED"},{originalFocusRestored:false},
    {preopenTargetIds:[reader]},{capturedAt:NaN}])
    expect(verifyNativeCheckpointReaderOwnership({...input(),record:{...record(),...patch}})).toBe(false);
 });
});
