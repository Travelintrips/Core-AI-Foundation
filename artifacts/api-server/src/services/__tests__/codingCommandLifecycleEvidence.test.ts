import { beforeEach,describe,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({rows:[] as unknown[],issuerValid:true,nativeValid:true}));
vi.mock("@workspace/db",()=>({db:{execute:async()=>({rows:mocks.rows})}}));
vi.mock("../devSopCheckpointIssuer.js",()=>({verifyDevSopCheckpointReceipt:()=>mocks.issuerValid}));
vi.mock("../nativeCheckpointAckReadiness.js",()=>({isPersistedNativeCheckpointAckVerified:()=>mocks.nativeValid&&mocks.issuerValid}));
import {getCodingCommandLifecycleEvidence} from "../codingCommandLifecycleEvidence.js";
const commandId="169a7492-cfd8-4a56-bb57-18001b6b5968";
const responseId="822efca2-7428-428a-ac66-548c0462438e";
function fixture(){const cmd={assignedClientId:"openclaw-dell-chatgpt-wake-dev",devOnly:true,capability:"chatgpt:wake"};return [
 {command_id:commandId,command_status:"FAILED",command_task_id:null,command_metadata:cmd,
  response_id:"00ca0911-c717-49c4-a278-093858a226a5",response_command_id:commandId,kind:"FAILED",message:"SOP_CHECKPOINT PAUSED",created_at:"2026-11-07T17:18:00Z"},
 {command_id:commandId,command_status:"FAILED",command_task_id:null,command_metadata:cmd,
  response_id:responseId,response_command_id:commandId,kind:"CHECKPOINT",message:null,created_at:"2026-11-07T17:18:10Z",
  acknowledged_at:"2026-11-07T17:19:51Z",checkpoint_json:{},response_metadata:{checkpointReceipt:{}}},
 ];}
beforeEach(()=>{mocks.rows=[];mocks.issuerValid=true;mocks.nativeValid=true});
describe("DEV GPT02 command lifecycle without AI Task association",()=>{
 it("returns not found for unknown command",async()=>expect(await getCodingCommandLifecycleEvidence(commandId)).toEqual({found:false,commandId}));
 it("rejects commands assigned to another worker",async()=>{
  mocks.rows=fixture().map(x=>({...x,command_metadata:{assignedClientId:"other"}}));
  expect((await getCodingCommandLifecycleEvidence(commandId)).found).toBe(false);
 });
 it("reports native ACK while explicitly withholding recovery and completion",async()=>{
  mocks.rows=fixture();const x=await getCodingCommandLifecycleEvidence(commandId);
  if(!x.found)throw Error("expected command");
  expect(x.taskId).toBeNull();
  expect(x.status).toBe("CHECKPOINT_ACKNOWLEDGED_REVIEW_REQUIRED");
  expect(x.nativeReceiverAckVerified).toBe(true);
  expect(x.checkpointAttested).toBe(true);
  expect(x.commandStatus).toBe("FAILED");
  expect(x.mayAutoResume).toBe(false);
  expect(x.mayAutoClose).toBe(false);
  expect(x.verifiedCompleted).toBe(false);
  expect(x.notificationAuthorized).toBe(false);
  expect(JSON.stringify(x)).not.toContain("SOP_CHECKPOINT PAUSED");
 });
 it("denies receipt and native ACK verification when response history exceeds the review window",async()=>{
  const base=fixture();
  const row=base[0]!;
  mocks.rows=[...Array.from({length:99},(_,i)=>({...row,response_id:`history-${i}`,kind:"PROGRESS"})),...base];
  const x=await getCodingCommandLifecycleEvidence(commandId);
  if(!x.found)throw Error("expected command");
  expect(x.responseSnapshotComplete).toBe(false);
  expect(x.status).toBe("RESPONSE_HISTORY_INCOMPLETE_REVIEW_REQUIRED");
  expect(x.checkpointAttested).toBe(false);
  expect(x.nativeReceiverAckVerified).toBe(false);
  expect(x.mayAutoResume).toBe(false);
 });
 it("rejects forged cross-command checkpoint response identity",async()=>{
  mocks.rows=fixture().map((r,i)=>i===1?{...r,response_command_id:"different-command"}:r);
  const x=await getCodingCommandLifecycleEvidence(commandId);
  if(!x.found)throw Error("expected command");
  expect(x.responseIdentityValid).toBe(false);
  expect(x.checkpointAttested).toBe(false);
  expect(x.nativeReceiverAckVerified).toBe(false);
  expect(x.status).toBe("RESPONSE_IDENTITY_INVALID_REVIEW_REQUIRED");
  expect(x.mayAutoResume).toBe(false);
 });
 it("rejects duplicate persisted response IDs",async()=>{
  const base=fixture();
  mocks.rows=[...base,{...base[0],kind:"PROGRESS"}];
  const x=await getCodingCommandLifecycleEvidence(commandId);
  if(!x.found)throw Error("expected command");
  expect(x.responseIdentityValid).toBe(false);
  expect(x.checkpointAttested).toBe(false);
  expect(x.nativeReceiverAckVerified).toBe(false);
 });
 it("rejects false ACK when issuer is not verified",async()=>{
  mocks.rows=fixture();mocks.issuerValid=false;const x=await getCodingCommandLifecycleEvidence(commandId);
  if(!x.found)throw Error("expected command");
  expect(x.nativeReceiverAckVerified).toBe(false);
  expect(x.status).toBe("CHECKPOINT_PENDING_VERIFICATION");
 });
 it("rejects unverified receiver and does not treat timestamp as completion",async()=>{
  mocks.rows=fixture();mocks.nativeValid=false;const x=await getCodingCommandLifecycleEvidence(commandId);
  if(!x.found)throw Error("expected command");
  expect(x.checkpointAcknowledged).toBe(true);
  expect(x.nativeReceiverAckVerified).toBe(false);
  expect(x.mayAutoResume).toBe(false);
 });
});
