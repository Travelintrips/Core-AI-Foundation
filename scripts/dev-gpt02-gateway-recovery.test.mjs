import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { DevGatewaySqliteStore, LedgerConflict } from "./dev-gpt02-gateway-sqlite-store.mjs";
import {
  makeOfficialReadRpc, observeOfficialRun, GatewayReadError,
} from "./dev-gpt02-gateway-official-reader.mjs";
import { dispatchOnce, reconcile, runKey } from "./dev-gpt02-gateway-bridge.mjs";

const runId="11111111-2222-4333-8444-555555555555";
const eventId="a".repeat(64);
const binding={
  accountAlias:"GPT02",workerId:"openclaw-dell-chatgpt-wake-dev",
  ownerChannel:"ai-engine-oauth:"+"c".repeat(64),
  targetConversationId:"6adc4295-e2ac-83ec-a1e1-2aea7d0c1326",
  gatewayAgentId:"gpt02-approved",provider:"openai",
  principalFingerprint:"d".repeat(64),credentialStatus:"VERIFIED",
  proofSource:"authorized-provider-identity-check",
  proofId:"44444444-5555-4333-8444-555555555555",
};
const work={
  commandId:"86c0ad23-f85a-41bf-a582-13d165fcc9b8",
  eventId,challenge:"b".repeat(64),
  correlationId:"ai-task:task-118:1:distinct-test",
  accountAlias:"GPT02",workerId:binding.workerId,
  ownerChannel:binding.ownerChannel,
  targetConversationId:binding.targetConversationId,
  devOnly:true,instruction:"DEV only. Do not mutate production.",
};
function withDb(task) {
  const temp=mkdtempSync(path.join(tmpdir(),"dev-gpt02-ledger-"));
  const dbFile=path.join(temp,"events.sqlite");
  return Promise.resolve().then(()=>task(dbFile)).finally(()=>rmSync(temp,{recursive:true,force:true}));
}
function makeRow(key) {
  return {key,status:"RESERVED",eventId,commandId:work.commandId};
}
test("SQLite reservation is durable across process restart", async()=>{
  await withDb(async file=>{
    const key="a".repeat(64);
    let db=new DevGatewaySqliteStore(file);
    assert.equal((await db.reserve(key,makeRow(key))).created,true);
    await db.transition(key,"RESERVED","SUBMITTED",{runId});
    db.close();
    db=new DevGatewaySqliteStore(file);
    assert.equal((await db.read(key)).runId,runId);
    assert.equal((await db.reserve(key,makeRow(key))).created,false);
    assert.equal((await db.read(key)).status,"SUBMITTED");
    db.close();
  });
});
test("SQLite two independent connections cannot reserve twice",async()=>{
  await withDb(async file=>{
    const a=new DevGatewaySqliteStore(file);
    const b=new DevGatewaySqliteStore(file);
    const key="b".repeat(64), row=makeRow(key);
    const results=await Promise.all([a.reserve(key,row),b.reserve(key,row)]);
    assert.equal(results.filter(x=>x.created).length,1);
    a.close();b.close();
  });
});
test("SQLite CAS rejects stale state and preserves earlier receipt",async()=>{
  await withDb(async file=>{
    const db=new DevGatewaySqliteStore(file),key="c".repeat(64);
    await db.reserve(key,makeRow(key));
    await db.transition(key,"RESERVED","SUBMISSION_UNKNOWN",{reason:"network"});
    await assert.rejects(db.transition(key,"RESERVED","SUBMITTED",{runId}),
      e=>e instanceof LedgerConflict && e.code==="LEDGER_STATE_CHANGED");
    assert.equal((await db.read(key)).status,"SUBMISSION_UNKNOWN");
    db.close();
  });
});
test("SQLite rejects mutable keys/status in patch",async()=>{
  await withDb(async file=>{
    const db=new DevGatewaySqliteStore(file),key="d".repeat(64);
    await db.reserve(key,makeRow(key));
    for(const patch of [{key:"e".repeat(64)},{status:"FINAL_ACK"}]){
      await assert.rejects(db.transition(key,"RESERVED","SUBMITTED",patch),
        e=>e instanceof LedgerConflict && e.code==="INVALID_LEDGER_TRANSITION");
    }
    assert.equal((await db.read(key)).status,"RESERVED");
    db.close();
  });
});
test("durable integration duplicate event cannot send again after restart",async()=>{
  await withDb(async file=>{
    let sendCalls=0;
    const gateway={
      identity:async()=>({
        authenticated:true,source:"gateway-credential-store",
        gatewayAgentId:binding.gatewayAgentId,provider:binding.provider,
        principalFingerprint:binding.principalFingerprint,
      }),
      send:async p=>{
        sendCalls++;
        return {accepted:true,runId,sessionKey:p.sessionKey};
      },
    };
    let store=new DevGatewaySqliteStore(file);
    const input={work,binding,gateway,store};
    assert.equal((await dispatchOnce(input)).status,"SUBMITTED");
    store.close();
    store=new DevGatewaySqliteStore(file);
    const r=await dispatchOnce({...input,store});
    assert.equal(r.deduplicated,true);
    assert.equal(r.status,"SUBMITTED");
    assert.equal(sendCalls,1);
    store.close();
  });
});
test("durable ambiguous send cannot replay after restart",async()=>{
  await withDb(async file=>{
    let sends=0;
    const gateway={
      identity:async()=>({
        authenticated:true,source:"gateway-credential-store",
        gatewayAgentId:binding.gatewayAgentId,provider:binding.provider,
        principalFingerprint:binding.principalFingerprint,
      }),
      send:async()=>{sends++;throw Error("lost response");},
    };
    let store=new DevGatewaySqliteStore(file);
    assert.equal((await dispatchOnce({work,binding,gateway,store})).status,
      "SUBMISSION_UNKNOWN");
    store.close();
    store=new DevGatewaySqliteStore(file);
    assert.equal((await dispatchOnce({work,binding,gateway,store})).deduplicated,true);
    assert.equal(sends,1);
    store.close();
  });
});
test("agent.wait timeout is pending, not a failed or retried job",async()=>{
  const result=await observeOfficialRun({
    rpc:async(method,params)=>{
      assert.equal(method,"agent.wait");
      assert.equal(params.runId,runId);
      return {runId,status:"timeout"};
    },runId,
  });
  assert.deepEqual(result,{status:"running",runId,terminalVerified:false});
});
test("agent.wait with terminal reply is explicitly NOT GPT02 principal verified",async()=>{
  const result=await observeOfficialRun({
    rpc:async()=>({
      runId,status:"ok",terminalReply:"test response",
      terminalReceipt:{sourceReplyDelivered:true},
    }),runId,
  });
  assert.deepEqual(result,{
    status:"terminal_observed",runId,terminalReply:"test response",
    terminalVerified:true,principalVerified:false,sourceReplyDelivered:true,
  });
});
test("wrong runId and absent terminal content fail closed",async()=>{
  await assert.rejects(observeOfficialRun({
    rpc:async()=>({runId:"55555555-5555-4555-8555-555555555555",status:"ok",terminalReply:"hello"}),
    runId,
  }), e=>e instanceof GatewayReadError&&e.code==="GATEWAY_RUN_MISMATCH");
  await assert.rejects(observeOfficialRun({
    rpc:async()=>({runId,status:"ok"}),runId,
  }),e=>e instanceof GatewayReadError&&e.code==="GATEWAY_TERMINAL_REPLY_UNAVAILABLE");
});
test("gateway agent failure and pending keep distinct outcomes",async()=>{
  const failed=await observeOfficialRun({rpc:async()=>({runId,status:"error"}),runId});
  const pending=await observeOfficialRun({rpc:async()=>({runId,status:"pending"}),runId});
  assert.equal(failed.status,"failed");
  assert.equal(pending.status,"running");
});
test("official CLI adapter refuses any send or browser RPC",async()=>{
  const gateway=makeOfficialReadRpc({
    executable:"fake-node",entrypoint:"fake-openclaw",spawnProcess:()=>{
      throw Error("DO_NOT_SPAWN");
    },
  });
  for(const name of ["chat.send","browser.snapshot","chat.inject","agent"]){
    await assert.rejects(gateway(name,{}),
      e=>e instanceof GatewayReadError&&e.code==="GATEWAY_METHOD_NOT_READ_ONLY");
  }
});
test("official CLI reader invokes the immutable runId with no shell",async()=>{
  let captured;
  const gateway=makeOfficialReadRpc({
    executable:"fake-node",entrypoint:"fake-openclaw",
    spawnProcess:(bin,args,opts)=>{
      captured={bin,args,opts};
      const child=new EventEmitter();
      child.stdout=new PassThrough();
      child.stderr=new PassThrough();
      child.kill=()=>{};
      queueMicrotask(()=>{
        child.stdout.end(JSON.stringify({runId,status:"timeout"}));
        child.emit("close",0,null);
      });
      return child;
    },
  });
  const result=await observeOfficialRun({rpc:gateway,runId});
  assert.equal(result.status,"running");
  assert.equal(captured.opts.shell,false);
  assert.equal(captured.args[3],"agent.wait");
  const parsed=JSON.parse(captured.args[captured.args.indexOf("--params")+1]);
  assert.equal(parsed.runId,runId);
});
