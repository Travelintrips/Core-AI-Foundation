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
const sessionKey="agent:gpt02-approved:ai-task-dev-"+"f".repeat(40);
const idempotencyKey="f".repeat(64);
const expectedArgs={runId,sessionKey,idempotencyKey};
function officialHistory(msgs,overrides={}) {
 return {sessionKey,messages:msgs,hasMore:false,...overrides};
}
function officialAssistant(overrides={}) {
 return {role:"assistant",idempotencyKey,provider:"openai",model:"gpt-5.5",
   stopReason:"stop",content:[{type:"text",text:"isolated verified gateway response"}],...overrides};
}
async function simulatedOfficial(method,params) {
 if(method==="agent.wait")return {runId,status:"ok"};
 if(method==="chat.history"){
   assert.equal(params.sessionKey,sessionKey);
   return officialHistory([
     {role:"user",idempotencyKey,content:"user prompt"},
     officialAssistant(),
   ]);
 }
 throw Error("unexpected gateway method");
}
test("agent.wait timeout is pending, no history fetch, no send",async()=>{
 const seen=[];
 const observed=await observeOfficialRun({
   rpc:async(method,params)=>{
     seen.push(method);
     assert.equal(params.runId,runId);
     return {runId,status:"timeout"};
   },...expectedArgs,
 });
 assert.deepEqual(observed,{status:"running",runId,terminalVerified:false});
 assert.deepEqual(seen,["agent.wait"]);
});
test("agent.wait then chat.history returns a bound assistant response, not account proof",async()=>{
 const seen=[];
 const result=await observeOfficialRun({
   rpc:async(method,params)=>{
     seen.push(method);
     return simulatedOfficial(method,params);
   },...expectedArgs,
 });
 assert.deepEqual(seen,["agent.wait","chat.history"]);
 assert.deepEqual(result,{
   status:"terminal_observed",runId,sessionKey,idempotencyKey,
   terminalReply:"isolated verified gateway response",
   provider:"openai",model:"gpt-5.5",
   terminalVerified:true,principalVerified:false,
   messageIdVerified:false,sourceReplyDelivered:false,
 });
});
test("wrong agent.wait runId fails before looking up another session",async()=>{
 const seen=[];
 await assert.rejects(observeOfficialRun({
   rpc:async(method)=>{
     seen.push(method);
     return {runId:"55555555-5555-4555-8555-555555555555",status:"ok"};
   },...expectedArgs,
 }),e=>e instanceof GatewayReadError && e.code==="GATEWAY_RUN_MISMATCH");
 assert.deepEqual(seen,["agent.wait"]);
});
test("wrong history sessionKey or incomplete history refuses attestation",async()=>{
 for(const patch of [
   {sessionKey:"agent:wrong:ai-task-dev-"+ "f".repeat(40)},
   {hasMore:true},
   {messages:null},
 ]){
   await assert.rejects(observeOfficialRun({
     rpc:async(method)=>method==="agent.wait"?{runId,status:"ok"}:
       officialHistory([officialAssistant()],patch),
     ...expectedArgs,
   }),e=>e instanceof GatewayReadError && e.code==="GATEWAY_HISTORY_CONTEXT_INVALID");
 }
});
test("missing, duplicated or mismatched idempotency key is rejected",async()=>{
 for(const messages of [
   [{role:"user",idempotencyKey,content:"marker only"}],
   [officialAssistant({idempotencyKey:"e".repeat(64)})],
   [officialAssistant(),officialAssistant()],
   [officialAssistant({role:"tool"})],
 ]){
   await assert.rejects(observeOfficialRun({
     rpc:async(method)=>method==="agent.wait"?{runId,status:"ok"}:
       officialHistory(messages),
     ...expectedArgs,
   }),e=>e instanceof GatewayReadError && e.code==="GATEWAY_REPLY_NOT_UNIQUELY_BOUND");
 }
});
test("model errors and missing provider/model provenance refuse result",async()=>{
 for(const m of [
   {stopReason:"error"},{stopReason:"aborted"},
   {provider:null},{model:null},
 ]){
   await assert.rejects(observeOfficialRun({
     rpc:async(method)=>method==="agent.wait"?{runId,status:"ok"}:
       officialHistory([officialAssistant(m)]),
     ...expectedArgs,
   }),e=>e instanceof GatewayReadError && e.code==="GATEWAY_MESSAGE_PROVENANCE_INVALID");
 }
});
test("empty, non-text or overly long assistant content is refused",async()=>{
 for(const content of [[],[{type:"image",url:"https://example.invalid/x"}],
   [{type:"text",text:""}],"x".repeat(4001),null]){
   await assert.rejects(observeOfficialRun({
     rpc:async(method)=>method==="agent.wait"?{runId,status:"ok"}:
       officialHistory([officialAssistant({content})]),
     ...expectedArgs,
   }),e=>e instanceof GatewayReadError && e.code==="GATEWAY_TERMINAL_REPLY_UNAVAILABLE");
 }
});
test("explicit model timeout and agent failure remain non-final",async()=>{
 const f=await observeOfficialRun({rpc:async()=>({runId,status:"error"}),...expectedArgs});
 const p=await observeOfficialRun({rpc:async()=>({runId,status:"pending"}),...expectedArgs});
 assert.equal(f.status,"failed");
 assert.equal(p.status,"running");
});
test("no unverifiable run/session can be passed to the official observer",async()=>{
 for(const fields of [
   {...expectedArgs,runId:"invalid"},
   {...expectedArgs,sessionKey:"agent:main:any-session"},
   {...expectedArgs,idempotencyKey:"untrusted key"},
 ]){
   await assert.rejects(observeOfficialRun({
     rpc:()=>{throw Error("NOT_CALLED");},
     ...fields,
   }),e=>e instanceof GatewayReadError && e.code==="INVALID_GATEWAY_OBSERVATION");
 }
});
test("official CLI adapter never allows message sending, browser or mutation RPC",async()=>{
 const gateway=makeOfficialReadRpc({
   executable:"fake-node",entrypoint:"fake-openclaw",
   spawnProcess:()=>{throw Error("DO_NOT_SPAWN");},
 });
 for(const name of ["chat.send","browser.snapshot","chat.inject","agent",
   "config.patch","agents.add","agents.delete"]){
   await assert.rejects(gateway(name,{}),
     e=>e instanceof GatewayReadError&&e.code==="GATEWAY_METHOD_NOT_READ_ONLY");
 }
});
test("official CLI invokes fixed method, exact args and no shell",async()=>{
 const captured=[];
 const rpc=makeOfficialReadRpc({
   executable:"fake-node",entrypoint:"fake-openclaw",
   spawnProcess:(bin,args,opts)=>{
     captured.push({bin,args,opts});
     const child=new EventEmitter();
     child.stdout=new PassThrough();
     child.stderr=new PassThrough();
     child.kill=()=>{};
     queueMicrotask(()=>{
       const method=args[3];
       child.stdout.end(JSON.stringify(method==="agent.wait"?
         {runId,status:"ok"}:officialHistory([officialAssistant()])));
       child.emit("close",0,null);
     });
     return child;
   },
 });
 const result=await observeOfficialRun({rpc,...expectedArgs});
 assert.equal(result.status,"terminal_observed");
 assert.deepEqual(captured.map(x=>x.args[3]),["agent.wait","chat.history"]);
 for(const call of captured){
   assert.equal(call.opts.shell,false);
   assert.equal(call.opts.stdio[0],"ignore");
 }
 const first=JSON.parse(captured[0].args[captured[0].args.indexOf("--params")+1]);
 const second=JSON.parse(captured[1].args[captured[1].args.indexOf("--params")+1]);
 assert.equal(first.runId,runId);
 assert.equal(second.sessionKey,sessionKey);
});

test("official Gateway history alone cannot trigger callback or fake Final ACK",async()=>{
  await withDb(async file=>{
    const store=new DevGatewaySqliteStore(file);
    let callbacks=0, sends=0;
    const gateway={
      identity:async()=>({
        authenticated:true,source:"gateway-credential-store",
        gatewayAgentId:binding.gatewayAgentId,provider:binding.provider,
        principalFingerprint:binding.principalFingerprint,
      }),
      send:async input=>{
        sends++;
        return {accepted:true,runId,sessionKey:input.sessionKey};
      },
      observe:async input=>observeOfficialRun({
        rpc:async(method,params)=>{
          if(method==="agent.wait")return {runId,status:"ok"};
          if(method==="chat.history")return {
            sessionKey:params.sessionKey,hasMore:false,
            messages:[{
              role:"assistant",idempotencyKey:runKey(work,binding),
              provider:"openai",model:"gpt-5.5",stopReason:"stop",
              content:[{type:"text",text:"[AI_CORE_ATTEST_ACK:"+work.challenge+"]"}],
            }],
          };
          throw Error("UNEXPECTED_RPC");
        },runId,sessionKey:input.sessionKey,idempotencyKey:runKey(work,binding),
      }),
    };
    const callback={
      submit:async()=>{callbacks++;throw Error("NO_CALLBACK_ALLOWED");},
      lookup:async()=>{throw Error("NO_CALLBACK_LOOKUP");},
      readFinalAck:async()=>{throw Error("NO_FINAL_ACK_LOOKUP");},
    };
    const input={work,binding,gateway,store,callback,privateKey:"unused"};
    assert.equal((await dispatchOnce(input)).status,"SUBMITTED");
    await assert.rejects(reconcile(input),
      e=>e?.code==="GATEWAY_REPLY_CONTEXT_INVALID");
    assert.equal(sends,1);
    assert.equal(callbacks,0);
    assert.equal((await store.read(runKey(work,binding))).status,"SUBMITTED");
    store.close();
  });
});
