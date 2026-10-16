import { describe, expect, it } from "vitest";
import { planDevJobRecovery, type RecoveryInput } from "../services/aiCoreDevJobRecoveryService.js";
const base: RecoveryInput = {
  blocker:"CONNECTOR_DISCONNECTED",attempt:0,session_id:"s1",job_id:"j1",event_id:"e1",
  environment:"DEV",job_terminal:false,callback_verified:false,ack_verified:false,
};
describe("DEV job recovery policy",()=>{
  it("retries transient disconnection with stable idempotency key",()=>{
    const first=planDevJobRecovery(base);
    const second=planDevJobRecovery({...base,attempt:1});
    expect(first.action).toBe("retry");
    expect(second.action).toBe("retry");
    if(first.action==="retry" && second.action==="retry"){
      expect(first.event_key).toBe(second.event_key);
      expect(second.delay_ms).toBeGreaterThan(first.delay_ms);
      expect(first.recheck_auth).toBe(true);
    }
  });
  it("never retries security denial or ownership conflict",()=>{
    expect(planDevJobRecovery({...base,blocker:"SECURITY_DENIED"}).action).toBe("stop");
    expect(planDevJobRecovery({...base,blocker:"JOB_CONFLICT"}).action).toBe("stop");
  });
  it("stops on terminal jobs, verified ACK and exhausted budget",()=>{
    expect(planDevJobRecovery({...base,job_terminal:true}).action).toBe("stop");
    expect(planDevJobRecovery({...base,callback_verified:true,ack_verified:true}).action).toBe("stop");
    expect(planDevJobRecovery({...base,attempt:3}).action).toBe("stop");
  });
});
