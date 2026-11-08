import {describe, expect, it} from "vitest";
import {assessGpt02RateLimitGate, type RateLimitEvidence} from "../gpt02LifecycleRateLimitGate.js";
const evidence=():RateLimitEvidence=>({
  workerHealthy:true,circuitState:"CLOSED",lastHttpStatus:200,
  lastResponseAt:"2026-11-08T12:00:00.000Z",retryAfter:null,
  now:"2026-11-08T12:00:10.000Z",
});
describe("GPT02 circuit, 429 Retry-After and worker health guard",()=>{
  it("clear evidence still never authorizes dispatch",()=>{
    expect(assessGpt02RateLimitGate(evidence())).toMatchObject({
      clearForFurtherReview:true,mayDispatchWorker:false,mayCloseJob:false});
  });
  it("unknown or failed worker health is blocked",()=>{
    for(const value of [false,null])
      expect(assessGpt02RateLimitGate({...evidence(),workerHealthy:value}).clearForFurtherReview).toBe(false);
  });
  it("never bypasses OPEN, HALF_OPEN, or UNKNOWN circuit",()=>{
    for(const state of ["OPEN","HALF_OPEN","UNKNOWN"] as const)
      expect(assessGpt02RateLimitGate({...evidence(),circuitState:state}).reason)
        .toBe("CIRCUIT_NOT_CLOSED");
  });
  it("missing, future or malformed rate-limit history is blocked",()=>{
    expect(assessGpt02RateLimitGate({...evidence(),lastHttpStatus:null}).reason)
      .toBe("RATE_LIMIT_HISTORY_NOT_VERIFIED");
    expect(assessGpt02RateLimitGate({...evidence(),lastResponseAt:"unknown"}).clearForFurtherReview).toBe(false);
    expect(assessGpt02RateLimitGate({...evidence(),lastResponseAt:"2026-11-08T13:00:00Z"}).clearForFurtherReview).toBe(false);
  });
  it("429 without verified Retry-After is blocked",()=>{
    expect(assessGpt02RateLimitGate({...evidence(),lastHttpStatus:429}).reason)
      .toBe("RETRY_AFTER_NOT_VERIFIED");
    expect(assessGpt02RateLimitGate({...evidence(),lastHttpStatus:429,retryAfter:"1000000"}).clearForFurtherReview).toBe(false);
  });
  it("honors delta-seconds Retry-After",()=>{
    expect(assessGpt02RateLimitGate({...evidence(),lastHttpStatus:429,retryAfter:"60"}))
      .toMatchObject({reason:"RETRY_AFTER_ACTIVE",retryAt:"2026-11-08T12:01:00.000Z"});
    expect(assessGpt02RateLimitGate({...evidence(),lastHttpStatus:429,retryAfter:"5"}))
      .toMatchObject({clearForFurtherReview:true,mayDispatchWorker:false});
  });
  it("honors HTTP-date Retry-After",()=>{
    expect(assessGpt02RateLimitGate({...evidence(),lastHttpStatus:429,
      retryAfter:"Sun, 08 Nov 2026 12:02:00 GMT"}).reason).toBe("RETRY_AFTER_ACTIVE");
    expect(assessGpt02RateLimitGate({...evidence(),lastHttpStatus:429,retryAfter:"tomorrow"}).clearForFurtherReview).toBe(false);
  });
  it("past Retry-After cannot override open circuit",()=>{
    expect(assessGpt02RateLimitGate({...evidence(),lastHttpStatus:429,
      retryAfter:"1",circuitState:"OPEN"}).reason).toBe("CIRCUIT_NOT_CLOSED");
  });
});
