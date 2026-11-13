import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  canonicalIssue159Release, issue159Challenge, issue159EventId,
  verifyIssue159ReleaseCandidate,
} from "./dev-gpt02-issue159-release-authorization.mjs";
import {
  BridgeViolation, dispatchOnce, reconcile, runKey, gatewaySessionKey,
} from "./dev-gpt02-gateway-bridge.mjs";

const CMD="10000000-0000-4000-8000-000000000001";
const ATT="20000000-0000-4000-8000-000000000002";
const PERMIT="30000000-0000-4000-8000-000000000003";
const CORE="50000000-0000-4000-8000-000000000005";
const CONV="6adc4295-e2ac-83ec-a1e1-2aea7d0c1326";
const PROOF="44444444-5555-4333-8444-555555555555";
const OWNER="ai-engine-oauth:"+"c".repeat(64);
const INSTRUCTION="Return the original verified response.";
const hash=s=>createHash("sha256").update(s).digest("hex");
const signing=generateKeyPairSync("ed25519");
const assistant=generateKeyPairSync("ed25519");
const now=1800000000000;

const binding={
  accountAlias:"GPT02", workerId:"openclaw-dell-chatgpt-wake-dev",
  ownerChannel:OWNER,targetConversationId:CONV,gatewayAgentId:"gpt02-approved",
  provider:"openai",principalFingerprint:"d".repeat(64),
  credentialStatus:"VERIFIED",proofSource:"authorized-provider-identity-check",
  proofId:PROOF,
};
function setup() {
  const release={
    version:1, environment:"DEV", audience:"GPT02_ISSUE159_EXACT_COMMAND_RELEASE_V1",
    hubTaskId:171,commandId:CMD,attemptId:ATT,permitId:PERMIT,coreTaskId:CORE,
    packetSha256:"a".repeat(64),instructionSha256:hash(INSTRUCTION),
    ownerChannel:OWNER,targetConversationId:CONV,workerId:binding.workerId,
    gatewayAgentId:binding.gatewayAgentId,provider:binding.provider,
    principalFingerprint:binding.principalFingerprint,gatewayProofId:PROOF,
    eventId:"",challenge:"",correlationId:"ai-task:default:171:"+CMD.slice(0,8),
    issuedAt:now-2000,expiresAt:now+4000,
  };
  release.eventId=issue159EventId(release);
  release.challenge=issue159Challenge(release);
  const held={
    id:CMD,taskId:CORE,source:"ai-core",commandType:"ISSUE159_HELD",
    status:"RECEIVED",externalCommandId:"gpt02-issue159:"+CMD,
    instruction:INSTRUCTION,
    metadata:{
      devOnly:true,issue159Stage:"NO_DISPATCH",
      gpt02Issue159PositivePermit:{
        commandId:CMD,attemptId:ATT,permitId:PERMIT,deliveryState:"HELD_NO_DISPATCH",
      },
    },
  };
  const signed=sign(null,canonicalIssue159Release(release),signing.privateKey).toString("base64");
  const input={
    release,signatureBase64:signed,publicKeyPem:signing.publicKey,held,
    binding,nowMs:now,
  };
  return input;
}
const code=c=>e=>e instanceof BridgeViolation&&e.code===c;
const verifyInput=input=>verifyIssue159ReleaseCandidate(input);

test("signed exact issuer UUID maps to existing gateway work, not a send",()=>{
  const r=verifyInput(setup());
  assert.equal(r.work.commandId,CMD);
  assert.equal(r.work.ownerChannel,OWNER);
  assert.equal(r.work.targetConversationId,CONV);
  assert.equal(r.work.instruction,INSTRUCTION);
  assert.equal(r.stage,"SIGNED_RELEASE_READY_FOR_SEPARATELY_AUTHORIZED_TRANSPORT");
  for (const key of ["oneUseDatabaseFenceVerified","liveGatewayPrincipalVerified",
    "workerCommandSent","finalAckVerified","dispatchPermitted"]) {
    assert.equal(r[key],false,key);
  }
  assert.equal(r.releaseDecision,"NO_GO");
});
test("unsigned, substituted signature or incorrect release root fails",()=>{
  const a=setup();
  assert.throws(()=>verifyInput({...a,signatureBase64:"A".repeat(86)+"=="}),
    code("INDEPENDENT_RELEASE_SIGNATURE_INVALID"));
  const wrong=generateKeyPairSync("ed25519");
  assert.throws(()=>verifyInput({...a,publicKeyPem:wrong.publicKey}),
    code("INDEPENDENT_RELEASE_SIGNATURE_INVALID"));
});
test("signed but stale, excessive TTL, future-dated or wrong environment denied",()=>{
  for (const patch of [
    {expiresAt:now-1},{expiresAt:now+30000},
    {issuedAt:now+1},{environment:"PROD"},
    {hubTaskId:166},{ownerChannel:"wrong"},
  ]) {
    const a=setup();
    a.release={...a.release,...patch};
    assert.throws(()=>verifyInput(a),e=>e instanceof BridgeViolation);
  }
});
test("wrong command, attempt, Core task or instruction binding denied",()=>{
  for (const patch of [
    {id:"99999999-9999-4999-8999-999999999999"},
    {taskId:"99999999-9999-4999-8999-999999999999"},
    {externalCommandId:"gpt02-issue159:wrong"},
    {instruction:"Unapproved new instructions"},
    {status:"PROCESSING"},
    {commandType:"EXTERNAL_AGENT_WORK"},
  ]) {
    const a=setup();a.held={...a.held,...patch};
    assert.throws(()=>verifyInput(a),code("PERSISTED_HELD_COMMAND_OR_INSTRUCTION_MISMATCH"));
  }
});
test("missing or forged protected marker and early worker assignment denied",()=>{
  for (const marker of [undefined, null, false,
    {commandId:CMD,attemptId:ATT,permitId:PERMIT,deliveryState:"SENT"},
    {commandId:CMD,attemptId:ATT,permitId:CORE,deliveryState:"HELD_NO_DISPATCH"}]) {
    const a=setup();a.held={
      ...a.held,metadata:{...a.held.metadata,gpt02Issue159PositivePermit:marker},
    };
    assert.throws(()=>verifyInput(a),code("PERSISTED_HELD_MARKER_INVALID"));
  }
  const a=setup();
  a.held.metadata={...a.held.metadata,assignedClientId:binding.workerId};
  assert.throws(()=>verifyInput(a),code("PERSISTED_HELD_MARKER_INVALID"));
});
test("signed release cannot switch owner, conversation, worker, provider or gateway identity",()=>{
  for (const b of [
    {ownerChannel:"ai-engine-oauth:"+"e".repeat(64)},
    {targetConversationId:"99999999-9999-4999-8999-999999999999"},
    {workerId:"openclaw-other-dev"},
    {provider:"ai-core"},
    {principalFingerprint:"e".repeat(64)},
    {gatewayAgentId:"other-agent"},
    {proofId:"77777777-7777-4777-8777-777777777777"},
  ]) {
    const a=setup();a.binding={...a.binding,...b};
    assert.throws(()=>verifyInput(a),e=>e instanceof BridgeViolation);
  }
});
test("release event and challenge cannot change independently of issuer IDs",()=>{
  for (const patch of [
    {eventId:"b".repeat(64)},{challenge:"f".repeat(64)},
    {correlationId:"ai-task:default:171:wrong-id"},
  ]) {
    const a=setup();a.release={...a.release,...patch};
    assert.throws(()=>verifyInput(a),code("RELEASE_EVENT_CORRELATION_DRIFT"));
  }
});
function gatewayFixture(work) {
  const data=new Map();
  const calls={send:0,lookup:0,callback:0,ack:0};
  const runId="11111111-2222-4333-8444-555555555555";
  const sessionKey=gatewaySessionKey(binding,work);
  const store={
    async reserve(key,row) {if(data.has(key))return {created:false,record:structuredClone(data.get(key))};data.set(key,structuredClone(row));return {created:true,record:structuredClone(row)};},
    async transition(key,from,to,patch) {const current=data.get(key);assert.equal(current?.status,from);data.set(key,{...current,...patch,status:to});},
    async read(key) {return structuredClone(data.get(key));},
  };
  const gateway={
    async identity() {return {authenticated:true,source:"gateway-credential-store",
      gatewayAgentId:binding.gatewayAgentId,provider:binding.provider,
      principalFingerprint:binding.principalFingerprint};},
    async send(req) {calls.send++;assert.equal(req.idempotencyKey,runKey(work,binding));
      return {accepted:true,runId,sessionKey:req.sessionKey};},
    async lookup() {calls.lookup++;return {accepted:true,runId,sessionKey};},
    async observe() {return {status:"completed",runId,sessionKey,
      provider:binding.provider,gatewayAgentId:binding.gatewayAgentId,
      principalFingerprint:binding.principalFingerprint,
      role:"assistant",final:true,messageId:"22222222-3333-4333-8444-555555555555",
      text:"synthetic [AI_CORE_ATTEST_ACK:"+work.challenge+"]"};},
  };
  const callback={
    async submit({receipt}) {calls.callback++;assert.equal(receipt.commandId,CMD);
      return {accepted:true,eventId:work.eventId,commandId:CMD};},
    async lookup(){return {accepted:true,eventId:work.eventId,commandId:CMD};},
    async readFinalAck(){calls.ack++;return {state:"COMPLETED",
      eventId:work.eventId,commandId:CMD,attestationVerified:true,
      ackId:"33333333-4444-4333-8444-555555555555"};},
  };
  return {work,binding,store,gateway,callback,privateKey:assistant.privateKey,calls};
}
test("synthetic signed release works with ORIGINAL gateway once-only transport and exact Final ACK",async()=>{
  const r=verifyInput(setup());
  const fixture=gatewayFixture(r.work);
  // Explicit transport invocation is TEST-ONLY. The real release adapter
  // deliberately never calls dispatchOnce and has no credential/service.
  const first=await dispatchOnce(fixture);
  assert.equal(first.status,"SUBMITTED");
  const second=await dispatchOnce(fixture);
  assert.equal(second.deduplicated,true);
  assert.equal(fixture.calls.send,1);
  const ack=await reconcile(fixture);
  assert.deepEqual(ack,{status:"FINAL_ACK",finalAckVerified:true});
  assert.equal(fixture.calls.send,1);
  assert.equal(fixture.calls.callback,1);
  assert.equal(fixture.calls.ack,1);
});
test("release verifier source cannot access gateway or worker directly",async()=>{
  const fs=await import("node:fs");
  const s=fs.readFileSync(new URL("./dev-gpt02-issue159-release-authorization.mjs",import.meta.url),"utf8");
  for(const token of ["dispatchOnce(","gateway.send(","http://","https://",
    "psycopg","postgres.connect","privateKey","process.env","fs.writeFile"]) {
    assert.equal(s.includes(token),false,token);
  }
});
