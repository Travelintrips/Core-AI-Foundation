import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {PgDialect} from "drizzle-orm/pg-core";
const mock=vi.hoisted(()=>({calls:[] as unknown[],rows:[] as Array<Record<string,unknown>>}));
vi.mock("@workspace/db",()=>({db:{transaction:async(f:(tx:unknown)=>Promise<unknown>)=>
  f({execute:async(q:unknown)=>{mock.calls.push(q);return {rows:mock.rows};}})}}));
import {canonicalGpt02NativeRecoveryFenceProof}
  from "../gpt02NativeRecoveryFenceProofContract.js";
import {verifyGpt02DevCurrentFenceReceipt}
  from "../gpt02DevCurrentFenceReceiptVerifier.js";
const {privateKey,publicKey}=generateKeyPairSync("ed25519");
const proof={
 protocol:"ai-core-gpt02-recovery-fence/v1",
 reservationId:"22aa961d-ac1e-4e12-a2c8-28ed07ff97cc",
 parentCommandId:"83db99f5-cbda-4e60-be71-3090fb411bbb",
 childCommandId:"41aa961d-ac1e-4e12-a2c8-28ed07ff97cc",
 humanReviewId:6,jobId:135,workerId:"gpt02-dell-worker",
 artifactSha256:"f".repeat(64),fencingToken:2,sequence:0,
 issuedAtUtcMs:1794078278000,expiresAtUtcMs:1794078308000,
};
const canonical=canonicalGpt02NativeRecoveryFenceProof(proof);
const signature=sign(null,canonical,privateKey);
const envelope={proof,signature:signature.toString("base64")};
const good=()=>({
 payload_sha256:createHash("sha256").update(canonical).digest("hex"),
 signature_sha256:createHash("sha256").update(signature).digest("hex"),
 issued_ms:String(proof.issuedAtUtcMs),expires_ms:String(proof.expiresAtUtcMs),
 current_token:String(proof.fencingToken),now_ms:String(proof.issuedAtUtcMs+10000),
});
beforeEach(()=>{mock.calls=[];mock.rows=[];process.env.APP_ENV="development";process.env.NODE_ENV="development";});
afterEach(()=>{delete process.env.APP_ENV;});
describe("DEV immutable receipt/current lease verification, no execution authority",()=>{
 it("production and invalid signatures cannot read DB",async()=>{
   process.env.APP_ENV="production";
   expect((await verifyGpt02DevCurrentFenceReceipt(envelope,publicKey)).ok).toBe(false);
   process.env.APP_ENV="development";
   const bad={...envelope,signature:sign(null,canonical,generateKeyPairSync("ed25519").privateKey).toString("base64")};
   expect((await verifyGpt02DevCurrentFenceReceipt(bad,publicKey)).reason).toBe("SIGNATURE_NOT_VERIFIED");
   expect(mock.calls).toHaveLength(0);
 });
 it("all current lineage, receipt, signer and lease checks must be in DB query",async()=>{
   expect((await verifyGpt02DevCurrentFenceReceipt(envelope,publicKey)).reason).toBe("SIGNED_RECEIPT_OR_CURRENT_LEASE_NOT_PROVEN");
   expect(mock.calls).toHaveLength(1);
   const q=new PgDialect().sqlToQuery(mock.calls[0] as Parameters<PgDialect["sqlToQuery"]>[0]);
   const body=q.sql.replace(/\s+/g," ");
   for(const clause of [
     "gpt02_dev_native_fence_signing_receipts",
     "gpt02_dev_recovery_command_links",
     "r.execution_authorized IS TRUE",
     "l.lease_owner=",
     "l.lease_expires_at>clock_timestamp()",
     "FOR SHARE OF f,r,li,l,parent,child",
     "parent.status='FAILED' AND child.status='RECEIVED'",
   ]) expect(body).toContain(clause);
   expect(q.params).toEqual([
     proof.reservationId,proof.childCommandId,proof.parentCommandId,
     6,135,proof.artifactSha256,proof.workerId,proof.fencingToken,
     proof.issuedAtUtcMs,proof.expiresAtUtcMs,proof.workerId,proof.fencingToken,
   ]);
 });
 it("matching mocked receipt and active lease never grants dispatch or native ACK",async()=>{
   mock.rows=[good()];
   const result=await verifyGpt02DevCurrentFenceReceipt(envelope,publicKey);
   expect(result).toMatchObject({ok:true,reason:"RECEIPT_AND_LEASE_VERIFIED_AT_READ",
     mayDispatchWorker:false,mayCreateCommand:false,mayCloseJob:false,nativeFinalAckVerified:false});
 });
 it("tampered digest, expired lease and stale fencing fail closed",async()=>{
   for(const patch of [
     {signature_sha256:"0".repeat(64)},
     {payload_sha256:"1".repeat(64)},
     {now_ms:String(proof.expiresAtUtcMs)},
     {current_token:"3"},
     {current_token:"9007199254740992"},
     {issued_ms:"invalid"},
   ]){
     mock.rows=[{...good(),...patch}];
     expect((await verifyGpt02DevCurrentFenceReceipt(envelope,publicKey)).ok).toBe(false);
   }
 });
 it("duplicate DB receipt rows cannot be accepted",async()=>{
   mock.rows=[good(),good()];
   expect((await verifyGpt02DevCurrentFenceReceipt(envelope,publicKey)).ok).toBe(false);
 });
 it("sequence 1 cannot be verified via initial-only receipt",async()=>{
   const renewal={...proof,sequence:1};
   const sig=sign(null,canonicalGpt02NativeRecoveryFenceProof(renewal),privateKey).toString("base64");
   expect((await verifyGpt02DevCurrentFenceReceipt({proof:renewal,signature:sig},publicKey)).reason)
      .toBe("UNSUPPORTED_INITIAL_SEQUENCE");
   expect(mock.calls).toHaveLength(0);
 });
});
