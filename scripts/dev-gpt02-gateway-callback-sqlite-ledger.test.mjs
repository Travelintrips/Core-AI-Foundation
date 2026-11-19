import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { DevGatewayCallbackLedger } from "./dev-gpt02-gateway-callback-sqlite-ledger.mjs";
test("durable receipt insert deduplicates identical replay and rejects altered replay after restart", async () => {
 const dir=mkdtempSync(path.join(os.tmpdir(),"gateway-callback-dev-"));
 const dbPath=path.join(dir,"events.sqlite");
 const eventId="a".repeat(64);
 const evidence={verified:true,transport:"openclaw-gateway",eventId,commandId:"command",runId:"run",sessionKey:"session",signingKeyId:"key"};
 const receipt={eventId,commandId:"command",runId:"run",sessionKey:"session",assistantResponseHash:"b".repeat(64),signature:"synthetic-signature"};
 try {
  let db=new DevGatewayCallbackLedger(dbPath);
  assert.equal((await db.acceptVerifiedEvidence(evidence,receipt)).attestationVerified,true);
  assert.deepEqual(await db.acceptVerifiedEvidence(evidence,receipt),await db.acceptVerifiedEvidence(evidence,receipt));
  assert.equal(await db.readFinalAck(eventId),null);
  db.close();
  db=new DevGatewayCallbackLedger(dbPath);
  assert.equal((await db.acceptVerifiedEvidence(evidence,receipt)).eventId,eventId);
  await assert.rejects(db.acceptVerifiedEvidence(evidence,{...receipt,signature:"changed"}),/GATEWAY_CALLBACK_REPLAY_CONFLICT/);
  await assert.rejects(db.acceptVerifiedEvidence({...evidence,commandId:"different"},{...receipt,commandId:"different"}),/GATEWAY_CALLBACK_REPLAY_CONFLICT/);
  db.close();
 } finally {rmSync(dir,{recursive:true,force:true});}
});
test("unverified evidence never reaches ledger",async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),"gateway-callback-dev-"));
 const db=new DevGatewayCallbackLedger(path.join(dir,"test.sqlite"));
 try {await assert.rejects(db.acceptVerifiedEvidence({verified:false},{}),/GATEWAY_LEDGER_EVIDENCE_INVALID/);}
 finally {db.close();rmSync(dir,{recursive:true,force:true});}
});

test("two ledger connections serialize same-event writes and reject conflicting receipt",async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),"gateway-callback-concurrent-"));
 const filename=path.join(dir,"shared.sqlite");
 const first=new DevGatewayCallbackLedger(filename);
 const second=new DevGatewayCallbackLedger(filename);
 const eventId="e".repeat(64);
 const evidence={verified:true,transport:"openclaw-gateway",eventId,commandId:"cmd",runId:"run",sessionKey:"sess",signingKeyId:"pinned"};
 const receipt={eventId,commandId:"cmd",runId:"run",sessionKey:"sess",assistantResponseHash:"f".repeat(64),signature:"original"};
 try {
  const accepted=await Promise.all([
   first.acceptVerifiedEvidence(evidence,receipt),
   second.acceptVerifiedEvidence(evidence,receipt),
  ]);
  assert.equal(accepted.length,2);
  assert.deepEqual(accepted[0],accepted[1]);
  await assert.rejects(
   second.acceptVerifiedEvidence(evidence,{...receipt,signature:"changed"}),
   /GATEWAY_CALLBACK_REPLAY_CONFLICT/
  );
 } finally {first.close(); second.close(); rmSync(dir,{recursive:true,force:true});}
});
