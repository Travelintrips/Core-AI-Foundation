import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({calls: 0, plan: [] as Array<Array<Record<string,unknown>>> }));
vi.mock("@workspace/db", () => ({ db: {
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
    execute: async () => ({rows: mock.plan[mock.calls++] ?? []}),
  }),
  execute: async () => ({rows: mock.plan[mock.calls++] ?? []}),
}}));
import {
  acquireGpt02DevRecoveryLease, heartbeatGpt02DevRecoveryLease,
  releaseGpt02DevRecoveryLease, validateGpt02LeaseRequest,
} from "../gpt02DevRecoveryLease.js";
const reservationId="22aa961d-ac1e-4e12-a2c8-28ed07ff97cc";
const workerId="gpt02-dell-worker";
const identity={reservationId, workerId};
const origNode=process.env["NODE_ENV"];
beforeEach(() => { process.env["APP_ENV"]="development";
  process.env["NODE_ENV"]="development";
  process.env["AI_CORE_DEV_GPT02_RESERVATIONS_ENABLED"]="true";
  process.env["AI_CORE_DEV_GPT02_LEASE_MUTATIONS_ENABLED"]="true";
  mock.calls=0;mock.plan=[];
});
afterEach(() => {
  delete process.env["AI_CORE_DEV_GPT02_LEASE_MUTATIONS_ENABLED"];
  delete process.env["AI_CORE_DEV_GPT02_RESERVATIONS_ENABLED"];
  delete process.env["APP_ENV"];
  if(origNode===undefined)delete process.env["NODE_ENV"];
  else process.env["NODE_ENV"]=origNode;
});
describe("GPT02 DEV durable lease CAS, zero dispatch authority", () => {
  it("denies disabled or production without DB access", async () => {
    delete process.env["AI_CORE_DEV_GPT02_LEASE_MUTATIONS_ENABLED"];
    expect(await acquireGpt02DevRecoveryLease({...identity,ttlSeconds:30})).toMatchObject({
      ok:false,reason:"LEASE_MUTATIONS_DISABLED",mayDispatchWorker:false});
    process.env["AI_CORE_DEV_GPT02_LEASE_MUTATIONS_ENABLED"]="true";
    process.env["APP_ENV"]="production";
    expect((await releaseGpt02DevRecoveryLease({...identity,fencingToken:"1"})).ok).toBe(false);
    expect(mock.calls).toBe(0);
  });
  it("rejects each incomplete environment/feature combination before DB access", async () => {
    const cases = [
      {key:"AI_CORE_DEV_GPT02_RESERVATIONS_ENABLED",value:"false"},
      {key:"AI_CORE_DEV_GPT02_RESERVATIONS_ENABLED",value:undefined},
      {key:"AI_CORE_DEV_GPT02_LEASE_MUTATIONS_ENABLED",value:"false"},
      {key:"NODE_ENV",value:"production"},
      {key:"APP_ENV",value:"staging"},
      {key:"APP_ENV",value:undefined},
    ] as const;
    for(const c of cases) {
      const old=process.env[c.key];
      if(c.value===undefined)delete process.env[c.key];
      else process.env[c.key]=c.value;
      for(const kind of ["acquire","heartbeat","release"] as const) {
        const result=kind==="acquire"
          ? await acquireGpt02DevRecoveryLease({...identity,ttlSeconds:30})
          : kind==="heartbeat"
          ? await heartbeatGpt02DevRecoveryLease({...identity,fencingToken:"1",ttlSeconds:30})
          : await releaseGpt02DevRecoveryLease({...identity,fencingToken:"1"});
        expect(result).toMatchObject({
          ok:false,reason:"LEASE_MUTATIONS_DISABLED",mayDispatchWorker:false,
        });
      }
      if(old===undefined)delete process.env[c.key];
      else process.env[c.key]=old;
    }
    expect(mock.calls).toBe(0);
  });
  it("rejects bad identity, token, and ttl", () => {
    expect(validateGpt02LeaseRequest({...identity,reservationId:"bad"})).toBe("INVALID_LEASE_SUBJECT");
    expect(validateGpt02LeaseRequest({...identity,workerId:" name "})).toBe("INVALID_LEASE_SUBJECT");
    expect(validateGpt02LeaseRequest({...identity,fencingToken:"0"})).toBe("INVALID_FENCING_TOKEN");
    expect(validateGpt02LeaseRequest({...identity,fencingToken:"1 OR TRUE"})).toBe("INVALID_FENCING_TOKEN");
    expect(validateGpt02LeaseRequest({...identity,ttlSeconds:121})).toBe("INVALID_LEASE_TTL");
  });
  it("refuses lease for reservation without issued durable command link", async () => {
    expect(await acquireGpt02DevRecoveryLease({...identity,ttlSeconds:30})).toMatchObject({
      ok:false,reason:"ISSUED_CHILD_LINEAGE_NOT_VERIFIED"});
    expect(mock.calls).toBe(1);
  });
  it("refuses duplicate lease owner contention", async () => {
    mock.plan=[[{reservation_id:reservationId}],[],[]];
    expect(await acquireGpt02DevRecoveryLease({...identity,ttlSeconds:30})).toMatchObject({
      ok:false,reason:"LEASE_ALREADY_OWNED"});
  });
  it("acquire returns token but never authorizes dispatch", async () => {
    mock.plan=[[{reservation_id:reservationId}],[],[{fencing_token:"1",lease_expires_at:"2026-11-08T12:10:00Z"}]];
    expect(await acquireGpt02DevRecoveryLease({...identity,ttlSeconds:30})).toMatchObject({
      ok:true,action:"ACQUIRED",fencingToken:"1",mayCreateCommand:false,
      mayDispatchWorker:false,mayCloseJob:false});
    expect(mock.calls).toBe(3);
  });
  it("heartbeat requires current owner/token and non-expired lease", async () => {
    expect(await heartbeatGpt02DevRecoveryLease({...identity,fencingToken:"1",ttlSeconds:30})).toMatchObject({
      ok:false,reason:"FENCING_TOKEN_STALE_OR_LEASE_EXPIRED"});
    mock.calls=0;mock.plan=[[{fencing_token:"2",lease_expires_at:"2026-11-08T12:10:00Z"}]];
    expect(await heartbeatGpt02DevRecoveryLease({...identity,fencingToken:"2",ttlSeconds:30})).toMatchObject({
      ok:true,action:"HEARTBEAT",fencingToken:"2",mayDispatchWorker:false});
  });
  it("release commits an owner-bound receipt in the same transaction", async () => {
    mock.plan=[[{fencing_token:"2",lease_expires_at:null}],[{fencing_token:"2"}]];
    expect(await releaseGpt02DevRecoveryLease({...identity,fencingToken:"2"})).toMatchObject({
      ok:true,action:"RELEASED",mayDispatchWorker:false});
    expect(mock.calls).toBe(2);
  });
  it("idempotent release requires receipt and matching unowned lease", async () => {
    mock.plan=[[],[{fencing_token:"2",lease_expires_at:null}]];
    expect(await releaseGpt02DevRecoveryLease({...identity,fencingToken:"2"})).toMatchObject({
      ok:true,action:"ALREADY_RELEASED",mayDispatchWorker:false});
    mock.calls=0;mock.plan=[[],[]];
    expect(await releaseGpt02DevRecoveryLease({...identity,fencingToken:"1"})).toMatchObject({
      ok:false,reason:"FENCING_TOKEN_STALE_OR_LEASE_EXPIRED"});
    mock.calls=0;mock.plan=[[],[]];
    expect(await releaseGpt02DevRecoveryLease({...identity,workerId:"other-worker",fencingToken:"2"})).toMatchObject({
      ok:false,reason:"FENCING_TOKEN_STALE_OR_LEASE_EXPIRED"});
  });
  it("refuses to acknowledge release if receipt is not durable", async () => {
    mock.plan=[[{fencing_token:"2",lease_expires_at:null}],[]];
    await expect(releaseGpt02DevRecoveryLease({...identity,fencingToken:"2"}))
      .rejects.toThrow("GPT02_RELEASE_RECEIPT_NOT_DURABLE");
  });
});
