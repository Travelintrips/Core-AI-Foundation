import test from "node:test";
import assert from "node:assert/strict";
import { acceptGatewayCallback } from "./dev-gpt02-gateway-callback-gate.mjs";
test("rejects absent or mismatched callback before storage access", async () => {
  let called = false;
  const trusted = { loadEvent: async () => { called = true; throw Error("unexpected"); } };
  for (const receipt of [null, {}, {eventId:"other"}]) {
    await assert.rejects(acceptGatewayCallback({receipt,eventId:"event",trusted,ledger:{}}));
  }
  assert.equal(called,false);
});
test("rejects missing trusted event before accepting evidence or writing ACK", async () => {
  let writes=0;
  const trusted={loadEvent:async()=>null};
  const ledger={acceptVerifiedEvidence:async()=>{writes++;}};
  await assert.rejects(acceptGatewayCallback({receipt:{eventId:"event"},eventId:"event",trusted,ledger}), /GATEWAY_TRUSTED_EVENT_MISSING/);
  assert.equal(writes,0);
});
test("rejects non-DEV record before credential inspection",async()=>{
  let inspected=0;
  const trusted={loadEvent:async()=>({eventId:"event",devOnly:false}),inspectGatewayCredential:async()=>{inspected++;}};
  await assert.rejects(acceptGatewayCallback({receipt:{eventId:"event"},eventId:"event",trusted,ledger:{}}), /GATEWAY_TRUSTED_EVENT_MISSING/);
  assert.equal(inspected,0);
});
