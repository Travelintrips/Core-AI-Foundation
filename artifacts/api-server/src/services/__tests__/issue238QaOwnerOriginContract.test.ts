import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  Issue238OriginDenied, verifyIssue238OwnerOrigin, ISSUE238_QA_TESTS,
} from "../issue238QaOwnerOriginContract.js";

const pair = Object.freeze({
  commandId:randomUUID(),jobId:randomUUID(),
  source:"issue238-dedicated-owner-stage" as const,
  state:"AWAITING_OWNER_APPROVAL" as const,
});
const keys=generateKeyPairSync("ed25519");
const pem=keys.publicKey.export({format:"pem",type:"spki"}).toString();
const fingerprint=createHash("sha256").update(pem).digest("hex");
const now=2_000_000_000;
function claims(){
  return {command_id:pair.commandId,job_id:pair.jobId,
    nonce:"NONCE-"+"a".repeat(32),worker_id:"openclaw-vps-main",
    operation:"issue238-pg17-disposable-qa",environment:"dev",
    project_ref:"xssrfshdrtdfupgqwfdw",
    sql_sha256:"0c7815ee6e9ffc9950ee1d7e5680e6debf8e11cd840074dd2991ec49fe6d79c4",
    image_sha256:"d9e2aef79dfb5d2737351a0010bb9d645726b331d42d4e25b87b31cff85d58d7",
    test:ISSUE238_QA_TESTS[0], issued_at:now-5,expires_at:now+85};
}
function signed(c:Record<string,unknown>=claims()){
  const encoded=Buffer.from(JSON.stringify(Object.fromEntries(
    Object.keys(c).sort().map(k=>[k,c[k]]))),"ascii");
  return {claims:c,owner_signature:sign(null,encoded,keys.privateKey).toString("base64")};
}
const opts={nowSeconds:now,expectedPublicPemSha256:fingerprint};
const good=(c=claims(),reservation:any=pair,publicPem=pem,options=opts)=>
  verifyIssue238OwnerOrigin(signed(c),reservation,publicPem,options);

describe("Issue238 Owner-signed exact AI Core reservation origin — source only",()=>{
  it("verifies genuine Owner signature and exact trusted durable pair",()=>{
    const result=good();
    expect(result).toMatchObject({commandId:pair.commandId,jobId:pair.jobId,
      verifiedOwnerSignature:true,selectedTest:ISSUE238_QA_TESTS[0]});
    expect(Object.isFrozen(result)).toBe(true);
  });
  it("fails closed without authoritative dedicated reserved pair",()=>{
    for(const input of [null,{...pair,state:"RECEIVED"},{...pair,source:"generic-bridge"},
      {...pair,jobId:randomUUID()}]){
      expect(()=>good(claims(),input)).toThrow(Issue238OriginDenied);
    }
  });
  it.each(["command_id","job_id"])("rejects Owner signature bound to different %s", key=>{
    const c={...claims(),[key]:randomUUID()};
    expect(()=>good(c)).toThrow("AUTHENTICATED_JOB_PAIR_MISMATCH");
  });
  it.each(["worker_id","operation","environment","project_ref","sql_sha256","image_sha256"])(
    "rejects out-of-scope %s even with valid signature",key=>{
      expect(()=>good({...claims(),[key]:"attacker"})).toThrow("OUT_OF_SCOPE_"+key);
    });
  it("rejects extra and missing signed fields",()=>{
    expect(()=>good({...claims(),unsafe:"TRUE"})).toThrow("UNREVIEWED_CLAIMS");
    const c:any=claims();delete c.test;
    expect(()=>good(c)).toThrow("UNREVIEWED_CLAIMS");
  });
  it("rejects unsigned/tampered Owner request",()=>{
    const receipt=signed();receipt.claims.job_id=randomUUID();
    expect(()=>verifyIssue238OwnerOrigin(receipt,pair,pem,opts))
      .toThrow("AUTHENTICATED_JOB_PAIR_MISMATCH");
    const wrong=signed();wrong.claims.test=ISSUE238_QA_TESTS[1];
    expect(()=>verifyIssue238OwnerOrigin(wrong,pair,pem,opts))
      .toThrow("OWNER_SIGNATURE_NOT_VERIFIED");
  });
  it("rejects untrusted signer even with mathematically valid signature",()=>{
    const other=generateKeyPairSync("ed25519");
    const fake=other.publicKey.export({format:"pem",type:"spki"}).toString();
    expect(()=>good(claims(),pair,fake)).toThrow("UNTRUSTED_OWNER_PUBLIC_KEY");
  });
  it.each(["unknown.sh","issue238-pg17-lock-expiry-concurrency-qa.sh; rm -rf /"])(
    "rejects unreviewed script %s",script=>{
      expect(()=>good({...claims(),test:script})).toThrow("UNLISTED_QA_TEST");
    });
  it.each([
    {issued_at:now-70,expires_at:now+20},
    {issued_at:now+1,expires_at:now+91},
    {issued_at:now-95,expires_at:now-5},
    {issued_at:now-5,expires_at:now+280},
  ])("rejects invalid Owner signature time window",patch=>{
    expect(()=>good({...claims(),...patch})).toThrow("OWNER_APPROVAL_EXPIRED");
  });
  it("never issues a job, permit, DB write or subprocess from this module",async()=>{
    const {readFileSync}=await import("node:fs");
    const source=readFileSync(new URL("../issue238QaOwnerOriginContract.ts",import.meta.url),"utf8");
    for(const command of ["db.execute(","db.insert(","subprocess.","docker run","sign(null,"]){
      expect(source).not.toContain(command);
    }
  });
});
