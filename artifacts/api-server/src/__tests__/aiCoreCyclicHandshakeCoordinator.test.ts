import { describe, expect, it, vi } from "vitest";
import { AiCoreCyclicHandshakeCoordinator } from "../services/aiCoreCyclicHandshakeCoordinatorService.js";
import { cyclicHandshakeSchema, cyclicResultSchema } from "../services/aiCoreCyclicHandshakeProtocolService.js";

const handshake = cyclicHandshakeSchema.parse({
  protocol:"ai-core-cycle/dev-v1",session_id:"s1",job_id:"j1",event_id:"h1",
  at:"2026-10-16T12:00:00+07:00",device_id:"zfold4-paired-dev-03",
  environment:"DEV",last_ack_event_id:"result1",
});
const result = cyclicResultSchema.parse({
  protocol:"ai-core-cycle/dev-v1",session_id:"s1",job_id:"j1",event_id:"result1",
  device_id:"zfold4-paired-dev-03",environment:"DEV",
  receipt_status:"VERIFIED",callback_verified:true,ack_verified:true,evidence_refs:["proof1"],
});
describe("DEV handshake coordinator security gates",()=>{
  it("refuses unpaired device and does not write handshake",async()=>{
    const store={get:vi.fn(),insertHandshakeOnce:vi.fn(),attachVerifiedResultOnce:vi.fn()};
    const c=new AiCoreCyclicHandshakeCoordinator(store as never,{isAuthorized:async()=>false},{verify:async()=>true});
    expect((await c.handshake(handshake)).accepted).toBe(false);
    expect(store.insertHandshakeOnce).not.toHaveBeenCalled();
  });
  it("refuses forged VERIFIED and incomplete callback/ACK",async()=>{
    const store={get:async()=>({handshake,result:null}),insertHandshakeOnce:async()=> "inserted" as const,attachVerifiedResultOnce:vi.fn()};
    const c=new AiCoreCyclicHandshakeCoordinator(store,{isAuthorized:async()=>true},{verify:async()=>false});
    expect((await c.receiveVerifiedResult(result)).accepted).toBe(false);
    expect((await c.receiveVerifiedResult({...result,ack_verified:false})).accepted).toBe(false);
    expect(store.attachVerifiedResultOnce).not.toHaveBeenCalled();
  });
  it("continues only with persisted verified result and matching ACK cursor",async()=>{
    const store={get:async()=>({handshake,result}),insertHandshakeOnce:async()=> "duplicate" as const,attachVerifiedResultOnce:async()=> "duplicate" as const};
    const c=new AiCoreCyclicHandshakeCoordinator(store,{isAuthorized:async()=>true},{verify:async()=>true});
    expect((await c.continue(handshake)).continued).toBe(true);
    expect((await c.continue({...handshake,last_ack_event_id:"other"})).continued).toBe(false);
  });
});
