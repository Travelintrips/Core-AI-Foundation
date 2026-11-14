import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  canonicalIssue159Release, issue159EventId, issue159Challenge,
  verifyIssue159ReleaseCandidate,
} from "./dev-gpt02-issue159-release-authorization.mjs";
import {
  deriveIssue159ClaimParameters,
  resolveIssue159TrustedGatewayBinding,
  reserveIssue159ClaimWithoutDispatch,
  inspectIssue159ClaimAfterCrash,
} from "./dev-gpt02-issue159-claim-admission.mjs";
import { BridgeViolation } from "./dev-gpt02-gateway-bridge.mjs";

const COMMAND="10000000-0000-4000-8000-000000000001";
const ATTEMPT="20000000-0000-4000-8000-000000000002";
const PERMIT="30000000-0000-4000-8000-000000000003";
const CORE="50000000-0000-4000-8000-000000000005";
const CONV="6adc4295-e2ac-83ec-a1e1-2aea7d0c1326";
const PROOF="44444444-5555-4333-8444-555555555555";
const OWNER="ai-engine-oauth:"+"c".repeat(64);
const PROMPT="Return the original verified response.";
const now=1800000000000;
const digest=input=>createHash("sha256").update(input).digest("hex");
const key=generateKeyPairSync("ed25519");
const binding=Object.freeze({
  accountAlias:"GPT02",workerId:"openclaw-dell-chatgpt-wake-dev",
  ownerChannel:OWNER,targetConversationId:CONV,gatewayAgentId:"gpt02-approved",
  provider:"openai",principalFingerprint:"d".repeat(64),
  credentialStatus:"VERIFIED",
  proofSource:"authorized-provider-identity-check",proofId:PROOF,
});
function fixture() {
  const release={
    version:1,environment:"DEV",
    audience:"GPT02_ISSUE159_EXACT_COMMAND_RELEASE_V1",
    hubTaskId:171,commandId:COMMAND,attemptId:ATTEMPT,permitId:PERMIT,
    coreTaskId:CORE,packetSha256:"a".repeat(64),
    instructionSha256:digest(PROMPT),ownerChannel:OWNER,
    targetConversationId:CONV,workerId:binding.workerId,
    gatewayAgentId:binding.gatewayAgentId,provider:binding.provider,
    principalFingerprint:binding.principalFingerprint,gatewayProofId:PROOF,
    eventId:"",challenge:"",correlationId:"ai-task:default:171:"+COMMAND.slice(0,8),
    issuedAt:now-1000,expiresAt:now+5000,
  };
  release.eventId=issue159EventId(release);
  release.challenge=issue159Challenge(release);
  const held={
    id:COMMAND,taskId:CORE,source:"ai-core",
    commandType:"ISSUE159_HELD",status:"RECEIVED",
    externalCommandId:"gpt02-issue159:"+COMMAND,
    instruction:PROMPT,
    metadata:{
      devOnly:true,issue159Stage:"NO_DISPATCH",
      gpt02Issue159PositivePermit:{
        commandId:COMMAND,attemptId:ATTEMPT,permitId:PERMIT,
        deliveryState:"HELD_NO_DISPATCH",
      },
    },
  };
  const signatureBase64=sign(null,canonicalIssue159Release(release),
    key.privateKey).toString("base64");
  const publicKeyPem=key.publicKey.export({type:"spki",format:"pem"});
  const proof=verifyIssue159ReleaseCandidate({
    release,signatureBase64,publicKeyPem,held,binding,nowMs:now,
  });
  return { release,signatureBase64,held,binding,proof };
}
const errorCode=code=>err=>err instanceof BridgeViolation&&err.code===code;
function readyModelStatus() {
  return {agentId:"gpt02-dev",defaultModel:"openai/gpt-5.5",
    resolvedDefault:"openai/gpt-5.5",
    auth:{storePath:"C:/AI-Core/gateway-stable3-main/agents/gpt02-dev/agent/openclaw-agent.sqlite",
      runtimeAuthRoutes:[{provider:"openai",runtime:"codex",status:"ready"}],
      modelRouteIssues:[],missingProvidersInUse:[]}};
}
function trustedFixture({b=binding,identity,modelStatus}={}) {
  const calls={load:0,inspect:0,model:0};
  return {
    calls,
    trusted: {
      async loadBinding(workerId) {
        calls.load++;
        assert.equal(workerId,"openclaw-dell-chatgpt-wake-dev");
        return b;
      },
      async inspectGatewayCredential(agentId) {
        calls.inspect++;
        assert.equal(agentId,b.gatewayAgentId);
        return identity ?? {
          authenticated:true,source:"gateway-credential-store",
          runtimeAuthStatus:"ready",modelRouteReady:true,
          gatewayAgentId:b.gatewayAgentId,
          provider:b.provider,
          principalFingerprint:b.principalFingerprint,
          proofId:b.proofId,
        };
      },
      async inspectOpenClawModelStatus(agentId) {
        calls.model++;
        assert.equal(agentId,"gpt02-dev");
        return modelStatus ?? readyModelStatus();
      },
    },
  };
}
test("signed release requires matching separately read provider registry identity",async()=>{
  const f=fixture();
  const t=trustedFixture();
  const actual=await resolveIssue159TrustedGatewayBinding(f.release,t.trusted);
  assert.equal(actual.accountAlias,"GPT02");
  assert.equal(actual.ownerChannel,OWNER);
  assert.equal(actual.targetConversationId,CONV);
  assert.equal(actual.gatewayAgentId,binding.gatewayAgentId);
  assert.equal(actual.principalFingerprint,binding.principalFingerprint);
  assert.deepEqual(t.calls,{load:1,inspect:1,model:1});
  assert.ok(Object.isFrozen(actual));
});
test("mismatched owner/target/provider/proof never passes the trusted binding readback",async()=>{
  const f=fixture();
  for(const patch of [
    {ownerChannel:"ai-engine-oauth:"+"e".repeat(64)},
    {targetConversationId:"77777777-7777-4777-8777-777777777777"},
    {workerId:"openclaw-travelintrips-dev"},
    {gatewayAgentId:"other-agent"},
    {provider:"other-provider"},
    {principalFingerprint:"e".repeat(64)},
    {proofId:"99999999-9999-4999-8999-999999999999"},
    {proofSource:"caller-metadata"},
    {credentialStatus:"UNKNOWN"},
  ]) {
    const t=trustedFixture({b:{...binding,...patch}});
    await assert.rejects(
      resolveIssue159TrustedGatewayBinding(f.release,t.trusted),
      e=>e instanceof BridgeViolation,
    );
    assert.equal(t.calls.inspect,0);
  }
});
test("false gateway provider identity, wrong source or rotated principal fails closed",async()=>{
  const f=fixture();
  for(const patch of [
    {authenticated:false}, {source:"job-metadata"},
    // Profile presence/OAuth freshness alone is not a usable model route.
    {runtimeAuthStatus:"missing"}, {runtimeAuthStatus:undefined},
    {modelRouteReady:false}, {modelRouteReady:undefined},
    {provider:"other-provider"},{gatewayAgentId:"other-agent"},
    {principalFingerprint:"e".repeat(64)},
    {proofId:undefined},
    {proofId:"99999999-9999-4999-8999-999999999999"},
  ]) {
    const t=trustedFixture({identity:{
      authenticated:true,source:"gateway-credential-store",
      runtimeAuthStatus:"ready",modelRouteReady:true,
      provider:binding.provider,gatewayAgentId:binding.gatewayAgentId,
      principalFingerprint:binding.principalFingerprint,
      proofId:binding.proofId,...patch,
    }});
    await assert.rejects(
      resolveIssue159TrustedGatewayBinding(f.release,t.trusted),
      errorCode("INDEPENDENT_GATEWAY_PROVIDER_IDENTITY_UNVERIFIED"),
    );
    assert.deepEqual(t.calls,{load:1,inspect:1,model:0});
  }
  for(const bad of [null,{}, {loadBinding:async()=>binding}]) {
    await assert.rejects(
      resolveIssue159TrustedGatewayBinding(f.release,bad),
      errorCode("TRUSTED_GATEWAY_READ_ADAPTER_REQUIRED"),
    );
  }
});


test("separate model status denies stored OAuth when selected GPT02 route is missing",async()=>{
  const f=fixture(), healthy=readyModelStatus();
  for(const bad of [
    {...healthy,agentId:"main"},
    {...healthy,resolvedDefault:"openai/gpt-6-astra"},
    {...healthy,auth:{...healthy.auth,storePath:"C:/unrelated/openclaw-agent.sqlite"}},
    {...healthy,auth:{...healthy.auth,runtimeAuthRoutes:[{provider:"openai",runtime:"codex",status:"missing"}]}},
    {...healthy,auth:{...healthy.auth,runtimeAuthRoutes:[]}},
    {...healthy,auth:{...healthy.auth,modelRouteIssues:[{kind:"missing-auth",provider:"openai",model:"gpt-5.5",authRequirement:"api-key"}]}},
    {...healthy,auth:{...healthy.auth,missingProvidersInUse:["openai"]}},
  ]) {
    const t=trustedFixture({modelStatus:bad});
    await assert.rejects(resolveIssue159TrustedGatewayBinding(f.release,t.trusted),
      errorCode("TRUSTED_GPT02_MODEL_ROUTE_UNREADY"));
    assert.deepEqual(t.calls,{load:1,inspect:1,model:1});
  }
  const t=trustedFixture();
  await assert.rejects(resolveIssue159TrustedGatewayBinding(f.release,{
    ...t.trusted,inspectOpenClawModelStatus:undefined,
  }),errorCode("TRUSTED_GATEWAY_READ_ADAPTER_REQUIRED"));
  assert.deepEqual(t.calls,{load:0,inspect:0,model:0});
});

test("synthetic signed release -> exact 12 immutable SQL claim parameters",()=>{
  const {release,signatureBase64,proof}=fixture();
  const record=deriveIssue159ClaimParameters({release,signatureBase64,proof});
  assert.equal(record.params.length,12);
  assert.equal(record.params[0],COMMAND);
  assert.equal(record.params[1],PERMIT);
  assert.equal(record.params[2],release.packetSha256);
  assert.equal(record.params[3],digest(canonicalIssue159Release(release)));
  assert.equal(record.params[4],digest(Buffer.from(signatureBase64,"base64")));
  assert.equal(record.params[5],digest(PROMPT));
  assert.equal(record.params[6],OWNER);
  assert.equal(record.params[7],CONV);
  assert.equal(record.params[8],release.eventId);
  assert.equal(record.params[9],release.challenge);
  assert.equal(record.params[10],release.issuedAt);
  assert.equal(record.params[11],release.expiresAt);
  assert.equal(record.releaseDecision,"NO_GO");
  assert.equal(record.dispatchPermitted,false);
  assert.ok(Object.isFrozen(record.params));
});

test("a forged synthetic proof or unrelated command cannot become claim evidence",()=>{
  const f=fixture();
  for(const modified of [
    {stage:"DISPATCH_GRANTED"},
    {releaseDecision:"GO"},
    {dispatchPermitted:true},
    {oneUseDatabaseFenceVerified:true},
    {workerCommandSent:true},
    {work:{...f.proof.work,commandId:CORE}},
    {work:{...f.proof.work,challenge:"0".repeat(64)}},
  ]) {
    assert.throws(()=>deriveIssue159ClaimParameters({
      release:f.release,signatureBase64:f.signatureBase64,
      proof:{...f.proof,...modified},
    }),errorCode("VERIFIED_RELEASE_CANDIDATE_REQUIRED"));
  }
  assert.throws(()=>deriveIssue159ClaimParameters({
    release:f.release,signatureBase64:"A".repeat(85)+"?==",proof:f.proof,
  }),errorCode("RELEASE_SIGNATURE_CANONICAL_REQUIRED"));
});

test("operational claim gate OFF before packet verification and SQL",async()=>{
  const f=fixture();
  const before={...process.env};
  try {
    delete process.env.GPT02_ISSUE159_CLAIM_ADMISSION_ENABLED;
    process.env.APP_ENV="development";
    let queries=0;
    const db={async query(){queries++;throw Error("NO_DB_ALLOWED");}};
    await assert.rejects(
      reserveIssue159ClaimWithoutDispatch(f,db),
      errorCode("CLAIM_ADMISSION_DISABLED"),
    );
    assert.equal(queries,0);
  }finally{process.env=before;}
});

test("operational verification reads HELD from DB before pinned root; never trusts caller JSON",async()=>{
  const f=fixture();
  const {proof,held,binding:callerBinding,...input}=f;
  const prior=Object.assign({},process.env);
  try {
    process.env.APP_ENV="development";
    process.env.GPT02_ISSUE159_CLAIM_ADMISSION_ENABLED="true";
    const seen=[];
    const db={
      async query(statement,args) {
        seen.push([statement,args]);
        if(statement==="BEGIN"||statement==="ROLLBACK")
          return {rows:[]};
        if(statement.startsWith("SELECT session_user::text"))
          return {rows:[{
            session_login:"dev_gpt02_claim_gate_login",
            active_role:"dev_gpt02_claim_gate_login",
          }]};
        if(statement.includes("read_issue159_held_for_claim"))
          return {rows:[{held}]};
        throw Error("UNEXPECTED_CLAIM_WRITE");
      },
    };
    // Independent root not installed in this disposable environment.
    await assert.rejects(
      reserveIssue159ClaimWithoutDispatch(input,db,trustedFixture().trusted),
      errorCode("CLAIM_RESERVATION_OUTCOME_UNCERTAIN_NO_DISPATCH"),
    );
    assert.equal(seen.length,4);
    assert.deepEqual(seen.map(x=>x[0]==="BEGIN"?"BEGIN":
      x[0]==="ROLLBACK"?"ROLLBACK":
      x[0].includes("read_issue159_held_for_claim")?"HELD_READER":"ROLE"),
      ["BEGIN","ROLE","HELD_READER","ROLLBACK"]);
    assert.deepEqual(seen[2][1],[COMMAND,PERMIT,"a".repeat(64)]);
    assert.ok(seen.every(x=>!x[0].includes("reserve_issue159_release_claim")));
  } finally {process.env=prior;}
});

test("forged Gateway credential readback cannot reach the claim RPC",async()=>{
  const f=fixture();
  const {proof,held,binding:callerBinding,...input}=f;
  const old={...process.env};
  try {
    process.env.APP_ENV="development";
    process.env.GPT02_ISSUE159_CLAIM_ADMISSION_ENABLED="true";
    const seen=[];
    const db={
      async query(sql,args) {
        seen.push([sql,args]);
        if(sql==="BEGIN" || sql==="ROLLBACK")return {rows:[]};
        if(sql.startsWith("SELECT session_user::text"))return {
          rows:[{session_login:"dev_gpt02_claim_gate_login",
                 active_role:"dev_gpt02_claim_gate_login"}],
        };
        if(sql.includes("read_issue159_held_for_claim"))return {rows:[{held}]};
        throw Error("CLAIM_RPC_MUST_NEVER_BE_CALLED");
      },
    };
    const trusted=trustedFixture({identity:{
      authenticated:true,
      runtimeAuthStatus:"ready",modelRouteReady:true,
      source:"caller-metadata",
      provider:binding.provider,
      gatewayAgentId:binding.gatewayAgentId,
      principalFingerprint:binding.principalFingerprint,
      proofId:binding.proofId,
    }});
    await assert.rejects(
      reserveIssue159ClaimWithoutDispatch(input,db,trusted.trusted),
      errorCode("CLAIM_RESERVATION_OUTCOME_UNCERTAIN_NO_DISPATCH"),
    );
    assert.deepEqual(trusted.calls,{load:1,inspect:1,model:0});
    assert.equal(seen.length,4);
    assert.equal(seen[0][0],"BEGIN");
    assert.equal(seen[3][0],"ROLLBACK");
    assert.ok(!seen.some(([sql])=>sql.includes("reserve_issue159_release_claim")));
    assert.ok(!seen.some(([sql])=>sql==="COMMIT"));
  }finally{process.env=old;}
});

test("unexpected caller clock, public key or claimed proof is forbidden",async()=>{
  const f=fixture();
  const {proof,held,binding:callerBinding,...input}=f;
  const prior=Object.assign({},process.env);
  try {
    process.env.APP_ENV="development";
    process.env.GPT02_ISSUE159_CLAIM_ADMISSION_ENABLED="true";
    const db={async query(){throw Error("SHOULD_NOT_QUERY");}};
    for(const extra of [
      {nowMs:now},{publicKeyPem:"attacker"},{held},{binding:callerBinding},
      {proof},{authApproved:true},{dispatchPermitted:true},
    ]) {
      await assert.rejects(
        reserveIssue159ClaimWithoutDispatch({...input,...extra},db),
        errorCode("OPERATIONAL_CLAIM_INPUT_INVALID"),
      );
    }
  }finally{process.env=prior;}
});

// Exercise the real exported readback only in a deliberately scoped DEV test
// environment; production or missing APP_ENV must remain fail-closed.
async function readInDev(input, connection) {
  const original=process.env.APP_ENV;
  try {
    process.env.APP_ENV="development";
    return await inspectIssue159ClaimAfterCrash(input, connection);
  } finally {
    if(original === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV=original;
  }
}

function fakeReadback(status,role="dev_gpt02_claim_gate_login") {
  const queries=[];
  const db={
    async query(sql,args) {
      queries.push([sql,args]);
      if(sql.startsWith("SELECT session_user::text"))
        return {rows:[{session_login:role,active_role:role}]};
      if(sql.startsWith("SELECT gpt02_private.inspect_issue159_release_claim"))
        return {rows:[{status}]};
      throw Error("UNEXPECTED_DATABASE_STATEMENT");
    },
  };
  return {db,queries};
}

test("readback rejects production, absent DEV and injected authority before DB access",async()=>{
  const original=process.env.APP_ENV;
  const selector={
    commandId:COMMAND,releaseSha256:"d".repeat(64),eventId:"b".repeat(64),
  };
  const {db,queries}=fakeReadback("RECORDED_NO_DISPATCH_GATEWAY_LOOKUP_REQUIRED");
  try {
    for(const badEnv of ["production",undefined,"test"]) {
      if(badEnv===undefined)delete process.env.APP_ENV;
      else process.env.APP_ENV=badEnv;
      await assert.rejects(
        inspectIssue159ClaimAfterCrash(selector,db),
        errorCode("CLAIM_READBACK_DEV_ONLY"),
      );
    }
    process.env.APP_ENV="development";
    for(const injected of [
      {dispatchPermitted:true},{nowMs:0},{publicKeyPem:"attacker"},
      {claimStatus:"AUTHORIZED_TO_SEND"},{ownerApproved:true},
    ]) {
      await assert.rejects(
        inspectIssue159ClaimAfterCrash({...selector,...injected},db),
        errorCode("CLAIM_READBACK_INPUT_SHAPE_INVALID"),
      );
    }
    assert.equal(queries.length,0);
  } finally {
    if(original===undefined)delete process.env.APP_ENV;
    else process.env.APP_ENV=original;
  }
});
test("crash readback only points to existing gateway idempotency lookup",async()=>{
  const {db,queries}=fakeReadback("RECORDED_NO_DISPATCH_GATEWAY_LOOKUP_REQUIRED");
  const result=await readInDev({
    commandId:COMMAND,releaseSha256:"d".repeat(64),eventId:"b".repeat(64),
  },db);
  assert.equal(result.claimStatus,"RECORDED_NO_DISPATCH_GATEWAY_LOOKUP_REQUIRED");
  assert.equal(result.gatewayLookupRequired,true);
  assert.equal(result.dispatchPermitted,false);
  assert.equal(result.workerCommandSent,false);
  assert.equal(result.releaseDecision,"NO_GO");
  assert.equal(queries.length,2);
  assert.deepEqual(queries[1][1],[COMMAND,"d".repeat(64),"b".repeat(64)]);
  for(const [sql] of queries) assert.doesNotMatch(sql,/INSERT|UPDATE|DELETE|COMMIT|dispatchOnce|gateway\.send/i);
});

test("wrong claim selectors and missing claim can never send",async()=>{
  const {db}=fakeReadback("NO_MATCHING_CLAIM_DO_NOT_SEND");
  const r=await readInDev({
    commandId:COMMAND,releaseSha256:"d".repeat(64),eventId:"b".repeat(64),
  },db);
  assert.equal(r.gatewayLookupRequired,false);
  assert.equal(r.releaseDecision,"NO_GO");
  await assert.rejects(
    readInDev({
      commandId:COMMAND,releaseSha256:"X".repeat(64),eventId:"b".repeat(64),
    },db),errorCode("CLAIM_READBACK_SELECTORS_INVALID"));
});

test("wrong DB identity and forged readback status fail closed",async()=>{
  const bad=fakeReadback("RECORDED_NO_DISPATCH_GATEWAY_LOOKUP_REQUIRED","service_role");
  await assert.rejects(
    readInDev({
      commandId:COMMAND,releaseSha256:"d".repeat(64),eventId:"b".repeat(64),
    },bad.db),errorCode("EXCLUSIVE_RELEASE_CLAIM_ROLE_REQUIRED"));
  assert.equal(bad.queries.length,1);
  const forged=fakeReadback("AUTHORIZED_TO_DISPATCH");
  await assert.rejects(
    readInDev({
      commandId:COMMAND,releaseSha256:"d".repeat(64),eventId:"b".repeat(64),
    },forged.db),errorCode("CLAIM_READBACK_RESULT_INVALID"));
});

test("direct pool-like connection is rejected before transaction",async()=>{
  const f=fixture();
  const {proof,held,binding:callerBinding,...input}=f;
  const previous={...process.env};
  try {
    process.env.APP_ENV="development";
    process.env.GPT02_ISSUE159_CLAIM_ADMISSION_ENABLED="true";
    let called=0;
    await assert.rejects(
      reserveIssue159ClaimWithoutDispatch(input,{
        connect(){called++;},
        async query(){called++;},
      }),
      errorCode("DEDICATED_CLAIM_DB_CLIENT_REQUIRED"),
    );
    assert.equal(called,0);
  }finally{process.env=previous;}
});

test("operational source never uses caller-held object for signature verification",()=>{
  const src=readFileSync(
    new URL("./dev-gpt02-issue159-claim-admission.mjs",import.meta.url),
    "utf8");
  assert.match(src,/read_issue159_held_for_claim/);
  assert.match(src,/held:\s*heldRead\.rows\[0\]\.held/);
  assert.doesNotMatch(src,/held:\s*input\.held/);
  assert.doesNotMatch(src,/binding:\s*input\.binding/);
  assert.match(src,/resolveIssue159TrustedGatewayBinding\(/);
  assert.match(src,/trusted\.loadBinding\(WORKER\)/);
  assert.match(src,/trusted\.inspectGatewayCredential\(binding\.gatewayAgentId\)/);
  assert.doesNotMatch(src,/\["release","signatureBase64","held","binding"\]/);
});

test("adapter contains no gateway/worker send, network clients or DB secrets",()=>{
  const src=readFileSync(
    new URL("./dev-gpt02-issue159-claim-admission.mjs",import.meta.url),
    "utf8");
  for(const forbidden of [
    "dispatchOnce(","gateway.send(","fetch(","http://","https://",
    "process.env.DATABASE_URL","pg.Pool","createPrivateKey(",
    "worker.send(","notifyExternalAgentWork(","client.connect(",
  ]) assert.equal(src.includes(forbidden),false,forbidden);
});
