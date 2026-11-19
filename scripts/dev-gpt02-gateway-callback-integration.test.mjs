import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fixture } from "./dev-gpt02-gateway-ai-core-verifier.test.mjs";
import { acceptGatewayCallback } from "./dev-gpt02-gateway-callback-gate.mjs";
import { DevGatewayCallbackLedger } from "./dev-gpt02-gateway-callback-sqlite-ledger.mjs";

test("signed synthetic callback passes gate, persists once, and never fabricates Final ACK", async () => {
  const f = fixture();
  const dir = mkdtempSync(path.join(os.tmpdir(),"gateway-gate-integration-"));
  const ledger = new DevGatewayCallbackLedger(path.join(dir,"callbacks.sqlite"));
  const trusted = {
    loadEvent: async () => f.expected,
    loadBinding: async () => f.binding,
    inspectGatewayCredential: async () => f.identity,
    loadPinnedSigningKey: async () => f.publicKey,
  };
  try {
    const args = { eventId:f.expected.eventId, receipt:f.receipt, trusted, ledger };
    const first = await acceptGatewayCallback(args);
    assert.deepEqual(first,{status:"CALLBACK_ACCEPTED",finalAckVerified:false});
    assert.deepEqual(await acceptGatewayCallback(args),first);
    await assert.rejects(acceptGatewayCallback({...args,receipt:{...f.receipt,signature:"tampered"}}));
    assert.deepEqual(await acceptGatewayCallback(args),first);
  } finally { ledger.close(); rmSync(dir,{recursive:true,force:true}); }
});
