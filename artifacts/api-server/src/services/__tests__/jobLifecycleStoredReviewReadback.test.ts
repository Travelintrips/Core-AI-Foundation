import {afterEach,beforeEach,describe,it,expect,vi} from "vitest";
const mock=vi.hoisted(()=>({execute:vi.fn(),readCommand:vi.fn(),assess:vi.fn()}));
vi.mock("@workspace/db",()=>({db:{execute:mock.execute}}));
vi.mock("../jobLifecycleRecoveryReview.js",()=>({getDevCommandRecoveryReview:mock.readCommand}));
vi.mock("../jobLifecycleStoredReviewPreflight.js",()=>({assessStoredDevOperatorReview:mock.assess}));
import {getDevStoredReviewReadback} from "../jobLifecycleStoredReviewReadback.js";

const reviewId="2e14f3e6-c7b0-41f5-81b8-1c5ff5cd4dc0";
const commandId="169a7492-cfd8-4a56-bb57-18001b6b5968";
const checkpoint="822efca2-7428-428a-ac66-548c0462438e";
const blocker="08b7b237-7a16-46d0-b79d-029d0363c112";
const now=new Date("2026-11-08T00:00:45.000Z");
const request=()=>({reviewId,now,trustedPublicKeyDerBase64:"synthetic-server-key"});
function seed() {
 mock.execute.mockResolvedValueOnce({rows:[{
  id:reviewId,command_id:commandId,checkpoint_response_id:checkpoint,
  blocker_response_id:blocker,worker_id:"openclaw-dell-chatgpt-wake-dev",
  operator_user_id:7,operator_role:"admin",nonce:"f".repeat(64),
  signed_at:new Date("2026-11-08T00:00:30.000Z"),
  expires_at:new Date("2026-11-08T00:01:30.000Z"),
  proof_json:{version:1},
 }]}).mockResolvedValueOnce({rows:[{
  id:7,role:"admin",status:"active",account_type:"internal",must_change_password:false,
 }]});
 mock.readCommand.mockResolvedValue({found:true,commandId,commandStatus:"PROCESSING",
  checkpointResponseId:checkpoint,blockingResponseId:blocker,
  responseSnapshotComplete:true,checkpointAttested:true,receiverAckVerified:true,
  blockerEvidenceValid:true});
 mock.assess.mockReturnValue({reviewVerified:true,reason:"SIGNED_STORED_REVIEW_VERIFIED_NOT_A_GRANT",
  mayIssueGrant:false,mayDispatchWorker:false});
}
beforeEach(()=>{
 process.env["APP_ENV"]="development";process.env["NODE_ENV"]="test";
 mock.execute.mockReset();mock.readCommand.mockReset();mock.assess.mockReset();
});
afterEach(()=>{delete process.env["APP_ENV"];delete process.env["NODE_ENV"];});
describe("DB-backed stored review readback is non-authorizing",()=>{
 it("passes real DB row shapes and current evidence to signature assessor",async()=>{
  seed();
  const x=await getDevStoredReviewReadback(request());
  expect(x).toMatchObject({verified:true,snapshotAtomic:false,grantIssuanceEnabled:false,
   mayIssueGrant:false,mayDispatchWorker:false,mayCloseJob:false});
  expect(mock.execute).toHaveBeenCalledTimes(2);
  expect(mock.readCommand).toHaveBeenCalledWith(commandId);
  expect(mock.assess).toHaveBeenCalledWith(expect.objectContaining({
   review:expect.objectContaining({commandId,operatorUserId:7}),
   operator:expect.objectContaining({id:7,status:"active",mustChangePassword:false}),
   evidence:expect.objectContaining({commandStatus:"PROCESSING",nativeReceiverAckVerified:true}),
  }));
 });
 it("rejects missing review before operator lookup",async()=>{
  mock.execute.mockResolvedValueOnce({rows:[]});
  expect(await getDevStoredReviewReadback(request())).toMatchObject({
   verified:false,reason:"STORED_REVIEW_NOT_FOUND",mayIssueGrant:false});
  expect(mock.execute).toHaveBeenCalledTimes(1);
  expect(mock.readCommand).not.toHaveBeenCalled();
 });
 it("fails closed when SQL is unavailable",async()=>{
  mock.execute.mockRejectedValueOnce(new Error("db unavailable"));
  expect(await getDevStoredReviewReadback(request())).toMatchObject({
   verified:false,reason:"STORED_REVIEW_READBACK_UNAVAILABLE",mayDispatchWorker:false});
 });
 it("declines terminal command even when review and operator exist",async()=>{
  seed();mock.readCommand.mockResolvedValue({found:false});
  expect(await getDevStoredReviewReadback(request())).toMatchObject({
   verified:false,reason:"CURRENT_COMMAND_NOT_FOUND"});
  expect(mock.assess).not.toHaveBeenCalled();
 });
 it("no reads are made outside DEV or for invalid review ID",async()=>{
  process.env["APP_ENV"]="production";
  expect(await getDevStoredReviewReadback(request())).toMatchObject({verified:false,reason:"DEV_ONLY"});
  process.env["APP_ENV"]="development";
  expect(await getDevStoredReviewReadback({...request(),reviewId:"bad"})).toMatchObject({
   verified:false,reason:"INVALID_REVIEW_ID"});
  expect(mock.execute).not.toHaveBeenCalled();
 });
 it("does not query any record without a server-trusted Ed25519 key",async()=>{
  const x=await getDevStoredReviewReadback({...request(),trustedPublicKeyDerBase64:undefined});
  expect(x).toMatchObject({verified:false,reason:"STORED_REVIEW_TRUST_KEY_UNCONFIGURED",
   mayIssueGrant:false,mayDispatchWorker:false});
  expect(mock.execute).not.toHaveBeenCalled();
  expect(mock.readCommand).not.toHaveBeenCalled();
 });
 it("rejects expired stored review before looking up operator or command",async()=>{
  mock.execute.mockResolvedValueOnce({rows:[{
   id:reviewId,command_id:commandId,checkpoint_response_id:checkpoint,
   blocker_response_id:blocker,worker_id:"openclaw-dell-chatgpt-wake-dev",
   operator_user_id:7,operator_role:"admin",nonce:"f".repeat(64),
   signed_at:new Date("2026-11-08T00:00:30.000Z"),
   expires_at:new Date("2026-11-08T00:00:44.000Z"),proof_json:{version:1},
  }]});
  const x=await getDevStoredReviewReadback(request());
  expect(x).toMatchObject({verified:false,reason:"STORED_REVIEW_EXPIRED_OR_INVALID",
   mayIssueGrant:false,mayDispatchWorker:false});
  expect(mock.execute).toHaveBeenCalledTimes(1);
  expect(mock.readCommand).not.toHaveBeenCalled();
  expect(mock.assess).not.toHaveBeenCalled();
 });
 it("even assessor rejection never grants execution",async()=>{
  seed();mock.assess.mockReturnValue({reviewVerified:false,reason:"STORED_PROOF_INVALID_SIGNATURE",
   mayIssueGrant:false,mayDispatchWorker:false});
  expect(await getDevStoredReviewReadback(request())).toMatchObject({
   verified:false,reason:"STORED_PROOF_INVALID_SIGNATURE",mayIssueGrant:false,
   mayDispatchWorker:false});
 });
});
