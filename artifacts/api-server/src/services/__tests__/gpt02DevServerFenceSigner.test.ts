import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, verify } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
const mock=vi.hoisted(()=>({
  calls:[] as unknown[],rows:[] as Array<Record<string,unknown>>,
}));
vi.mock("@workspace/db",()=>({
  db:{transaction:async (f:(tx:unknown)=>Promise<unknown>)=>
    f({execute:async(q:unknown)=>{mock.calls.push(q);return {rows:mock.rows};}})},
}));
import { signGpt02DevInitialFence,validateGpt02ServerFenceSigningSubject }
 from "../gpt02DevServerFenceSigner.js";
import { canonicalGpt02NativeRecoveryFenceProof }
 from "../gpt02NativeRecoveryFenceProofContract.js";

const ids={
  reservationId:"22aa961d-ac1e-4e12-a2c8-28ed07ff97cc",
  parentCommandId:"83db99f5-cbda-4e60-be71-3090fb411bbb",
  childCommandId:"41aa961d-ac1e-4e12-a2c8-28ed07ff97cc",
  workerId:"dell-gpt02-dev",jobId:135,humanReviewId:6,
};
const {privateKey,publicKey}=generateKeyPairSync("ed25519");
beforeEach(()=>{
  mock.calls=[];mock.rows=[];
  Object.assign(process.env,{
    APP_ENV:"development",NODE_ENV:"development",
    AI_CORE_DEV_GPT02_RESERVATIONS_ENABLED:"true",
    AI_CORE_DEV_GPT02_LEASE_MUTATIONS_ENABLED:"true",
    AI_CORE_DEV_GPT02_NATIVE_FENCE_SIGNING_ENABLED:"true",
  });
});
afterEach(()=>{
  for(const k of ["APP_ENV","AI_CORE_DEV_GPT02_RESERVATIONS_ENABLED",
    "AI_CORE_DEV_GPT02_LEASE_MUTATIONS_ENABLED",
    "AI_CORE_DEV_GPT02_NATIVE_FENCE_SIGNING_ENABLED"]) delete process.env[k];
});
describe("DEV native lease-bound initial fence signer (NOT routed)",()=>{
  it("all three independent operational gates must be explicitly enabled",async()=>{
    for(const k of ["AI_CORE_DEV_GPT02_RESERVATIONS_ENABLED",
      "AI_CORE_DEV_GPT02_LEASE_MUTATIONS_ENABLED",
      "AI_CORE_DEV_GPT02_NATIVE_FENCE_SIGNING_ENABLED"]){
      process.env[k]="false";
      const r=await signGpt02DevInitialFence(ids,privateKey);
      expect(r).toMatchObject({ok:false,reason:"NATIVE_FENCE_SIGNING_DISABLED",
        mayDispatchWorker:false,nativeAckVerified:false});
      process.env[k]="true";
    }
    process.env.APP_ENV="production";
    expect((await signGpt02DevInitialFence(ids,privateKey)).ok).toBe(false);
    expect(mock.calls).toHaveLength(0);
  });
  it("rejects invalid identities before accessing database",async()=>{
    expect(validateGpt02ServerFenceSigningSubject({...ids,workerId:"bad worker"}))
      .toBe("INVALID_FENCE_SUBJECT");
    expect((await signGpt02DevInitialFence({...ids,childCommandId:ids.parentCommandId},privateKey))
      .ok).toBe(false);
    expect(mock.calls).toHaveLength(0);
  });
  it("requires an actual server Ed25519 private key",async()=>{
    const other=generateKeyPairSync("rsa",{modulusLength:2048});
    expect((await signGpt02DevInitialFence(ids,other.privateKey)).ok).toBe(false);
    expect(mock.calls).toHaveLength(0);
  });
  it("refuses missing current authorized DB lease",async()=>{
    const result=await signGpt02DevInitialFence(ids,privateKey);
    expect(result).toMatchObject({ok:false,reason:"CURRENT_AUTHORIZED_LEASE_NOT_PROVEN"});
    expect(mock.calls).toHaveLength(1);
    const compiled=new PgDialect().sqlToQuery(mock.calls[0] as Parameters<PgDialect["sqlToQuery"]>[0]);
    const sql=compiled.sql.replace(/\s+/g," ");
    expect(sql).toContain("r.execution_authorized IS TRUE");
    expect(sql).toContain("l.lease_owner=");
    expect(sql).toContain("l.lease_expires_at>clock_timestamp()+interval '1 second'");
    expect(sql).toContain("FOR UPDATE OF r,li,l,parent,child");
    expect(sql).toContain("li.child_command_id=r.candidate_command_id");
    expect(sql).toContain("parent.status='FAILED'");
    expect(sql).toContain("child.status='RECEIVED'");
    expect(compiled.params).toEqual([
      ids.reservationId,ids.parentCommandId,ids.childCommandId,135,6,ids.workerId,
    ]);
  });
  it("synthetic authorized row creates cross-language canonical Ed25519 proof but no dispatch",async()=>{
    // This is MOCK DATA only: actual DEV schema forces execution_authorized=false.
    mock.rows=[{artifact_sha256:"f".repeat(64),fencing_token:"2",
      now_ms:"1794078278000",expiration_ms:"1794078288000"}];
    const result=await signGpt02DevInitialFence(ids,privateKey);
    expect(result.ok).toBe(true);
    if(!result.ok) throw Error("unexpected synthetic denial");
    expect(result.mayDispatchWorker).toBe(false);
    expect(result.nativeAckVerified).toBe(false);
    expect(result.proof.sequence).toBe(0);
    expect(verify(null,canonicalGpt02NativeRecoveryFenceProof(result.proof),
      publicKey,Buffer.from(result.signature,"base64"))).toBe(true);
  });
  it("rejects an expired, fractional or unsafe BIGINT fencing token",async()=>{
    for(const row of [
      {fencing_token:"9007199254740992",now_ms:"1794078278000",expiration_ms:"1794078288000"},
      {fencing_token:"1.5",now_ms:"1794078278000",expiration_ms:"1794078288000"},
      {fencing_token:"2",now_ms:"1794078278000",expiration_ms:"1794078278000"},
      {fencing_token:"2",now_ms:"1794078278000",expiration_ms:"1794078478000"},
    ]){
      mock.rows=[{artifact_sha256:"f".repeat(64),...row}];
      expect((await signGpt02DevInitialFence(ids,privateKey)).ok).toBe(false);
    }
  });
  it("rejects all duplicate DB rows",async()=>{
    const row={artifact_sha256:"f".repeat(64),fencing_token:"2",
      now_ms:"1794078278000",expiration_ms:"1794078288000"};
    mock.rows=[row,row];
    expect((await signGpt02DevInitialFence(ids,privateKey)).ok).toBe(false);
  });
});
