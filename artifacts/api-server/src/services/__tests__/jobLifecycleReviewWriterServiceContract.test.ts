import {describe,it,expect,vi} from "vitest";
import {generateKeyPairSync,sign} from "node:crypto";
import {createIsolatedDevReviewWriterContract} from "../jobLifecycleReviewWriterServiceContract.js";
import {operatorApprovalProofPayload,type OperatorApprovalProof}
 from "../jobLifecycleOperatorApprovalProof.js";

const keys=generateKeyPairSync("ed25519");
const now=new Date("2026-11-08T00:01:00.000Z");
const publicKeyDerBase64=keys.publicKey.export({type:"spki",format:"der"}).toString("base64");
const base:Omit<OperatorApprovalProof,"signatureBase64">={
 version:1,action:"gpt02.resume.grant.review",
 commandId:"169a7492-cfd8-4a56-bb57-18001b6b5968",
 checkpointResponseId:"822efca2-7428-428a-ac66-548c0462438e",
 blockerResponseId:"08b7b237-7a16-46d0-b79d-029d0363c112",
 workerId:"openclaw-dell-chatgpt-wake-dev",operatorId:"internal:7",operatorRole:"admin",
 issuedAt:"2026-11-08T00:00:30.000Z",expiresAt:"2026-11-08T00:02:00.000Z",
 nonce:"0123456789abcdef".repeat(4),
};
const proof:OperatorApprovalProof={
 ...base,signatureBase64:sign(null,Buffer.from(operatorApprovalProofPayload(base)),keys.privateKey).toString("base64"),
};
function fixture(options:{appEnv?:string;nodeEnv?:string;publicKey?:string;now?:Date}={}){
 const adapter=vi.fn(async(_proof:OperatorApprovalProof)=>true);
 const contract=createIsolatedDevReviewWriterContract({
  appEnv:options.appEnv??"development",nodeEnv:options.nodeEnv??"test",
  publicKeyDerBase64:options.publicKey??publicKeyDerBase64,
  verifiedWriterAdapter:adapter,now:()=>options.now??now,
 });
 return {contract,adapter};
}
describe("isolated verifier-to-writer service contract (not deployed)",()=>{
 it("passes valid short-lived signed review to a private adapter, never grants execution",async()=>{
  const {contract,adapter}=fixture();
  expect(await contract({proof})).toMatchObject({recorded:true,mayIssueGrant:false,mayDispatchWorker:false});
  expect(adapter).toHaveBeenCalledExactlyOnceWith(proof);
 });
 it("denies nonce tampering before private adapter",async()=>{
  const {contract,adapter}=fixture();
  const result=await contract({proof:{...proof,nonce:"a".repeat(64)}});
  expect(result).toMatchObject({recorded:false,reason:"PROOF_INVALID_SIGNATURE"});
  expect(adapter).not.toHaveBeenCalled();
 });
 it("denies BLOCKER tampering before private adapter",async()=>{
  const {contract,adapter}=fixture();
  expect((await contract({proof:{...proof,blockerResponseId:base.checkpointResponseId}})).recorded).toBe(false);
  expect(adapter).not.toHaveBeenCalled();
 });
 it("denies expired evidence before any writer operation",async()=>{
  const {contract,adapter}=fixture({now:new Date("2026-11-08T00:03:00.000Z")});
  expect((await contract({proof})).recorded).toBe(false);
  expect(adapter).not.toHaveBeenCalled();
 });
 it("denies a swapped verifier key",async()=>{
  const different=generateKeyPairSync("ed25519").publicKey.export({type:"spki",format:"der"}).toString("base64");
  const {contract,adapter}=fixture({publicKey:different});
  expect((await contract({proof})).recorded).toBe(false);
  expect(adapter).not.toHaveBeenCalled();
 });
 it.each(["production","testing"])("refuses non-DEV appEnv %s",async appEnv=>{
  const {contract,adapter}=fixture({appEnv});
  expect((await contract({proof})).recorded).toBe(false);
  expect(adapter).not.toHaveBeenCalled();
 });
 it("refuses production node process",async()=>{
  const {contract,adapter}=fixture({nodeEnv:"production"});
  expect((await contract({proof})).recorded).toBe(false);
  expect(adapter).not.toHaveBeenCalled();
 });
 it("does not accept arbitrary SQL, adapter, or operator identity fields",async()=>{
  const {contract,adapter}=fixture();
  for(const field of ["sql","query","adapter","operatorUserId"]){
   const r=await contract({proof,[field]:"SELECT * FROM secrets"});
   expect(r).toMatchObject({recorded:false,reason:"INVALID_REQUEST"});
  }
  expect(adapter).not.toHaveBeenCalled();
 });
 it("denies new proof fields before adapter",async()=>{
  const {contract,adapter}=fixture();
  expect((await contract({proof:{...proof,extra:"not signed"}})).recorded).toBe(false);
  expect(adapter).not.toHaveBeenCalled();
 });
 it("fails closed if atomic adapter rejects current DB evidence",async()=>{
  const {contract,adapter}=fixture();
  adapter.mockResolvedValueOnce(false);
  expect(await contract({proof})).toMatchObject({recorded:false,reason:"ATOMIC_DATABASE_EVIDENCE_DENIED"});
 });
 it("fails closed if isolated DB adapter throws",async()=>{
  const {contract,adapter}=fixture();
  adapter.mockRejectedValueOnce(new Error("unavailable"));
  expect(await contract({proof})).toMatchObject({recorded:false,reason:"WRITER_UNAVAILABLE"});
 });
});
