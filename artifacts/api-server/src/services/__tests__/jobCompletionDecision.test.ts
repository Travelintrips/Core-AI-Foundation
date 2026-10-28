import {describe,it,expect} from "vitest";
import {decideJobCompletion} from "../jobCompletionDecision.js";
const sha="a".repeat(40);
const gate={verified:true,commitSha:sha,evidenceId:"trusted-record"};
const valid={jobId:"j",commandId:"c",commitSha:sha,persistedTerminalStatus:"COMPLETED",
 ackMatchesCommand:true,ci:gate,deployment:gate,productionHealth:gate,e2e:gate};
describe("completion decision",()=>{
 it("requires all independent gates",()=>expect(decideJobCompletion(valid).status).toBe("E2E_PASS"));
 it("rejects wrong deployment commit",()=>expect(decideJobCompletion({...valid,deployment:{...gate,commitSha:"b".repeat(40)}}).eligibleForNotification).toBe(false));
 it("rejects missing E2E",()=>expect(decideJobCompletion({...valid,e2e:{...gate,verified:false}}).eligibleForNotification).toBe(false));
 it("rejects mismatched ACK",()=>expect(decideJobCompletion({...valid,ackMatchesCommand:false}).eligibleForNotification).toBe(false));
 it("produces stable idempotency keys",()=>expect(decideJobCompletion(valid).idempotencyKey).toBe(decideJobCompletion(valid).idempotencyKey));
});
