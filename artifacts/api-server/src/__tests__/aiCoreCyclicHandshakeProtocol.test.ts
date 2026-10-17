import { describe, expect, it } from "vitest";
import { canContinueCycle, cyclicHandshakeSchema, cyclicResultSchema, planRoutineSop } from "../services/aiCoreCyclicHandshakeProtocolService.js";

const handshake = cyclicHandshakeSchema.parse({
  protocol:"ai-core-cycle/dev-v1",session_id:"session-1",job_id:"job-1",
  event_id:"handshake-1",at:"2026-10-16T12:00:00+07:00",
  device_id:"zfold4-paired-dev-03",environment:"DEV",last_ack_event_id:"result-1",
});
const verified = cyclicResultSchema.parse({
  protocol:"ai-core-cycle/dev-v1",session_id:"session-1",job_id:"job-1",
  event_id:"result-1",device_id:"zfold4-paired-dev-03",environment:"DEV",
  receipt_status:"VERIFIED",callback_verified:true,ack_verified:true,evidence_refs:["device-e2e-1"],
});
describe("DEV cyclic handshake",()=>{
  it("issues routine SOP but never directly authorizes dispatch",()=>{
    const sop=planRoutineSop(handshake);
    expect(sop.sop_id).toBe("ROUTINE_ZFOLD4_JOB_V1");
    expect(sop.dispatch_authorized).toBe(false);
    expect(sop.requires_pairing).toBe(true);
  });
  it("continues only with matching verified callback and ACK",()=>{
    expect(canContinueCycle(handshake,verified)).toBe(true);
    expect(canContinueCycle(handshake,{...verified,receipt_status:"RECEIVED_UNVERIFIED"})).toBe(false);
    expect(canContinueCycle(handshake,{...verified,ack_verified:false})).toBe(false);
    expect(canContinueCycle(handshake,{...verified,device_id:"zfold4-other"})).toBe(false);
    expect(canContinueCycle({...handshake,last_ack_event_id:null},verified)).toBe(false);
  });
  it("rejects PROD and invalid device",()=>{
    expect(cyclicHandshakeSchema.safeParse({...handshake,environment:"PROD"}).success).toBe(false);
    expect(cyclicHandshakeSchema.safeParse({...handshake,device_id:"desktop"}).success).toBe(false);
  });
});
