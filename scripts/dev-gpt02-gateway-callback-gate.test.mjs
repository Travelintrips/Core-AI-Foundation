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

test("rejects missing trusted binding without inspecting credentials or writing", async () => {
  let inspected = 0, writes = 0;
  const trusted = {
    loadEvent: async () => ({ eventId: "event", devOnly: true, workerId: "dell" }),
    loadBinding: async () => null,
    inspectGatewayCredential: async () => { inspected++; },
  };
  const ledger = { acceptVerifiedEvidence: async () => { writes++; } };
  await assert.rejects(
    acceptGatewayCallback({ receipt: { eventId: "event" }, eventId: "event", trusted, ledger }),
    /GATEWAY_TRUSTED_BINDING_MISSING/
  );
  assert.equal(inspected, 0);
  assert.equal(writes, 0);
});
test("rejects absent pinned key before any ledger write", async () => {
  let writes = 0;
  const trusted = {
    loadEvent: async () => ({ eventId: "event", devOnly: true, workerId: "dell" }),
    loadBinding: async () => ({ workerId: "dell", gatewayAgentId: "agent", signingKeyId: "key" }),
    inspectGatewayCredential: async () => ({ authenticated: true }),
    loadPinnedSigningKey: async () => null,
  };
  const ledger = { acceptVerifiedEvidence: async () => { writes++; } };
  await assert.rejects(
    acceptGatewayCallback({ receipt: { eventId: "event" }, eventId: "event", trusted, ledger }),
    /GATEWAY_PINNED_KEY_MISSING/
  );
  assert.equal(writes, 0);
});

test("callback persistence statement is executable, not hidden in comment", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./dev-gpt02-gateway-callback-gate.mjs", import.meta.url), "utf8");
  assert.match(source, /^  const saved = await ledger\.acceptVerifiedEvidence\(evidence, receipt\);$/m);
  assert.doesNotMatch(source, /\\\\n  \\//);
});
