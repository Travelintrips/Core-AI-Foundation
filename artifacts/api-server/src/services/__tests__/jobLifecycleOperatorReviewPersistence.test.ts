import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {generateKeyPairSync,sign} from "node:crypto";
import {operatorApprovalProofPayload,type OperatorApprovalProof} from "../jobLifecycleOperatorApprovalProof.js";
const fake=vi.hoisted(()=>({execute:vi.fn(),transaction:vi.fn()}));
vi.mock("@workspace/db",()=>({db:{execute:fake.execute,transaction:fake.transaction}}));
import {persistSignedDevOperatorReviewIntent} from "../jobLifecycleOperatorReviewPersistence.js";
const keys=generateKeyPairSync("ed25519");
const trustedPublicKeyDerBase64=keys.publicKey.export({format:"der",type:"spki"}).toString("base64");
const commandId="169a7492-cfd8-4a56-bb57-18001b6b5968";
const cp="822efca2-7428-428a-ac66-548c0462438e";
const bl="08b7b237-7a16-46d0-b79d-029d0363c112";
const now=new Date("2026-11-08T00:00:45.000Z");
function makeProof():OperatorApprovalProof {
 const base:Omit<OperatorApprovalProof,"signatureBase64">={
  version:1,action:"gpt02.resume.grant.review",commandId,
  checkpointResponseId:cp,blockerResponseId:bl,workerId:"openclaw-dell-chatgpt-wake-dev",
  operatorId:"internal:7",operatorRole:"admin",
  issuedAt:"2026-11-08T00:00:30.000Z",expiresAt:"2026-11-08T00:02:00.000Z",
  nonce:"0123456789abcdef".repeat(4),
 };
 return {...base,signatureBase64:sign(null,Buffer.from(operatorApprovalProofPayload(base)),keys.privateKey).toString("base64")};
}
function invoke(proof:OperatorApprovalProof=makeProof(),user=7){
 return persistSignedDevOperatorReviewIntent({proof,trustedPublicKeyDerBase64,
  operatorUserId:user,operatorRole:"admin",now});
}
beforeEach(()=>{process.env["APP_ENV"]="development";process.env["NODE_ENV"]="test";
 process.env["AI_CORE_DEV_OPERATOR_REVIEW_SIGNING_ENABLED"]="true";
 fake.execute.mockReset();fake.transaction.mockReset();
 fake.transaction.mockImplementation(async (fn:(tx:{execute:typeof fake.execute})=>unknown)=>fn({execute:fake.execute}));});
afterEach(()=>{delete process.env["APP_ENV"];delete process.env["NODE_ENV"];
 delete process.env["AI_CORE_DEV_OPERATOR_REVIEW_SIGNING_ENABLED"];});
describe("durable review intent audit, never actionable grant",()=>{
 it("returns record id only after constrained DB insertion succeeds",async()=>{
  fake.execute.mockResolvedValueOnce({rows:[{id:commandId}]}).mockResolvedValueOnce({rows:[{id:"5a8f3b1b-3486-4380-a668-f1fb0af48b81"}]});
  const x=await invoke();
  expect(x).toMatchObject({recorded:true,reason:"SIGNED_REVIEW_INTENT_AUDITED_NOT_A_GRANT",
   mayIssueGrant:false,mayDispatchWorker:false});
  expect(fake.transaction).toHaveBeenCalledTimes(1);
  expect(fake.execute).toHaveBeenCalledTimes(2);
 });
 it("refuses success if transaction inserts zero rows",async()=>{
  fake.execute.mockResolvedValueOnce({rows:[{id:commandId}]}).mockResolvedValueOnce({rows:[]});
  expect(await invoke()).toMatchObject({recorded:false,reason:"DATABASE_EVIDENCE_CHANGED_OR_DENIED",mayIssueGrant:false});
 });
 it("refuses success when DB fails, e.g. repeated nonce unique conflict",async()=>{
  fake.execute.mockResolvedValueOnce({rows:[{id:commandId}]}).mockRejectedValueOnce(new Error("unique constraint"));
  expect(await invoke()).toMatchObject({recorded:false,reason:"AUDIT_PERSISTENCE_FAILED",mayDispatchWorker:false});
 });
 it("refuses success when command row lock finds no command",async()=>{
  fake.execute.mockResolvedValueOnce({rows:[]});
  expect(await invoke()).toMatchObject({recorded:false,reason:"DATABASE_EVIDENCE_CHANGED_OR_DENIED"});
  expect(fake.execute).toHaveBeenCalledTimes(1);
  expect(fake.transaction).toHaveBeenCalledTimes(1);
 });
 it("refuses signing if the row-locking statement fails",async()=>{
  fake.execute.mockRejectedValueOnce(new Error("lock timeout"));
  expect(await invoke()).toMatchObject({recorded:false,reason:"AUDIT_PERSISTENCE_FAILED"});
  expect(fake.execute).toHaveBeenCalledTimes(1);
 });
 it("does not query the DB for a forged identity",async()=>{
  expect(await invoke(makeProof(),8)).toMatchObject({recorded:false,reason:"OPERATOR_IDENTITY_MISMATCH"});
  expect(fake.execute).not.toHaveBeenCalled();
 });
 it("does not query the DB for tampered signed proof",async()=>{
  expect(await invoke({...makeProof(),workerId:"other"})).toMatchObject({recorded:false,reason:"SIGNATURE_INVALID_SIGNATURE"});
  expect(fake.execute).not.toHaveBeenCalled();
 });
 it("denies all writes with disabled server feature",async()=>{
  delete process.env["AI_CORE_DEV_OPERATOR_REVIEW_SIGNING_ENABLED"];
  expect(await invoke()).toMatchObject({recorded:false,reason:"DEV_DISABLED"});
  expect(fake.execute).not.toHaveBeenCalled();
 });
});
