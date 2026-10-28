import { describe,it,expect } from "vitest";
import { probeTrustedReleaseHealth } from "../trustedJobHealthVerifier.js";
const sha="a".repeat(40);
const input={configuredReleaseUrl:"https://aicore.example.test/api/healthz",expectedCommitSha:sha};
const response=(body:unknown,status=200)=>async()=>({ok:status===200,status,json:async()=>body});
describe("trusted release health probe",()=>{
  it("accepts exact committed healthy release response",async()=>{
    expect((await probeTrustedReleaseHealth(input,response({status:"ok",commitSha:sha}))).verified).toBe(true);
  });
  it("rejects green health lacking build identity",async()=>{
    expect((await probeTrustedReleaseHealth(input,response({status:"ok"}))).verified).toBe(false);
  });
  it("rejects mismatched commit",async()=>{
    expect((await probeTrustedReleaseHealth(input,response({status:"ok",commitSha:"b".repeat(40)}))).verified).toBe(false);
  });
  it("rejects non-TLS endpoint",async()=>{
    expect((await probeTrustedReleaseHealth({...input,configuredReleaseUrl:"http://host/api/healthz"},response({status:"ok",commitSha:sha}))).verified).toBe(false);
  });
  it("fails closed if unavailable",async()=>{
    expect((await probeTrustedReleaseHealth(input,async()=>{throw Error("offline")})).verified).toBe(false);
  });
});
