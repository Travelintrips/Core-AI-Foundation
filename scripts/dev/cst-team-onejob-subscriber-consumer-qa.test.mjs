import assert from "node:assert/strict";
import { createHash,generateKeyPairSync,sign } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { consumeOneCstDevCompletionOnce } from "./cst-team-onejob-subscriber-consumer-qa.mjs";

const keys=generateKeyPairSync("ed25519");
const other=generateKeyPairSync("ed25519");
const publicKeyPem=keys.publicKey.export({type:"spki",format:"pem"});
const publicKeySha256=createHash("sha256").update(
  keys.publicKey.export({type:"spki",format:"der"})).digest("hex");
const scope={
  jobId:483,jobCode:"CSTDEV-ONEJOB-483",workerId:991,
  requestId:"cst-ai-team-company1-dev:pilot-"+"a".repeat(20),
};
const trust={roleName:"cst_team_onejob_subscriber_20261120_abcdef12",
  subscriberId:"cst-dev-onejob-subscriber-20261120-abcdef12",
  publicKeyPem,publicKeySha256};
const now=new Date("2026-11-20T00:02:00.000Z");
const event={
  event_id:"25745d53-9c8d-46ae-8afc-62bfbba92711",
  event_type:"job.completed",source_module:"job-engine",
  source_id:"483",status:"published",
  correlation_id:"24a5dc22-318b-42b4-aaed-a7c84e24cd21",
  published_at:"2026-11-20T00:00:00.000Z",
  payload_json:{jobId:483,workerId:991,jobCode:scope.jobCode,
    jobType:"ollama_model_invocation"},
};
function fixture({role=trust.roleName,events=[event],insertionError}={}){
  const calls=[];const inserted=[];
  const db={async query(query,values=[]){
    calls.push({query,values});
    if(query==="SELECT current_user AS authenticated_role"){
      return {rows:[{authenticated_role:role}]};
    }
    if(query.includes("FROM ai_platform.ai_events")){
      assert.deepEqual(values,["483"]);return {rows:events};
    }
    if(query.startsWith("INSERT INTO ai_platform.ai_audit_logs")){
      if(insertionError)throw insertionError;
      inserted.push(JSON.parse(values[2]));
      return {rowCount:1};
    }
    throw Error("UNEXPECTED_QUERY");
  }};
  return {db,calls,inserted};
}
function fakeSigner(privateKey=keys.privateKey){
  return async bytes=>sign(null,bytes,privateKey).toString("base64");
}
async function consume(mods={},f=fixture()){
  const input={
    client:f.db,scope:{...scope,...mods.scope},
    trustedSubscriber:{...trust,...mods.trust},
    signPayload:mods.signer||fakeSigner(),
    now:mods.now||now,
  };
  return {out:await consumeOneCstDevCompletionOnce(input),f};
}
test("exact RLS event receipt is signed and inserted once with NO audit-read or event-update",async()=>{
  const f=fixture();
  const {out}=await consume({},f);
  assert.equal(out.claimedInsertCount,1);
  assert.equal(out.subscriberDeliveryVerified,false);
  assert.equal(out.durableReceiptReadbackVerified,false);
  assert.equal(out.independentFinalAckVerified,false);
  assert.equal(f.inserted.length,1);
  assert.equal(f.inserted[0].payload.eventId,event.event_id);
  assert.equal(f.inserted[0].publicKeySha256,publicKeySha256);
  assert.deepEqual(f.calls.map(v=>v.query.split(" ")[0]),["SELECT","SELECT","INSERT"]);
  assert.ok(!f.calls.some(v=>/\bUPDATE\b|\bDELETE\b|\bFROM ai_platform\.ai_jobs\b/.test(v.query)));
});
test("wrong RLS role, no visible event or duplicate visible events deny before signing",async()=>{
  for(const changed of [
    {role:"postgres"},{role:"cst_team_model_pilot_writer"},
    {events:[]},{events:[event,event]},
  ]){
    const f=fixture(changed);
    let called=0;
    await assert.rejects(
      consumeOneCstDevCompletionOnce({
        client:f.db,scope,trustedSubscriber:trust,now,
        signPayload:async()=>{called++;return fakeSigner()(Buffer.from("x"))},
      }),/CST_SUBSCRIBER_/);
    assert.equal(called,0);
    assert.equal(f.inserted.length,0);
  }
});
test("wrong job, Company 3, historic #482 and wrong worker fail without DB access",async()=>{
  for(const patch of [
    {jobId:482},{jobId:0},{jobId:484},{workerId:0},
    {requestId:"cst-ai-team-company3-dev:pilot-"+"a".repeat(20)},
  ]){
    const f=fixture();
    if(patch.jobId===484){f.db.query=async()=>{throw Error("UNEXPECTED_QUERY")};}
    const rejected=await Promise.allSettled([
      consumeOneCstDevCompletionOnce({client:f.db,scope:{...scope,...patch},
        trustedSubscriber:trust,now,signPayload:fakeSigner()})
    ]);
    assert.equal(rejected[0].status,"rejected");
    assert.equal(f.inserted.length,0);
  }
});
test("mismatched event identity, stale published-at, double events all fail before insert",async()=>{
  const cases=[
    {...event,source_id:"484"},
    {...event,status:"failed"},
    {...event,correlation_id:"invalid"},
    {...event,payload_json:{...event.payload_json,workerId:42}},
    {...event,payload_json:{...event.payload_json,jobCode:"fake"}},
    {...event,published_at:"2026-11-19T21:00:00.000Z"},
    {...event,published_at:"2026-11-20T01:00:00.000Z"},
  ];
  for(const e of cases){
    const f=fixture({events:[e]});
    await assert.rejects(
      consumeOneCstDevCompletionOnce({client:f.db,scope,
        trustedSubscriber:trust,now,signPayload:fakeSigner()}),/CST_SUBSCRIBER_/);
    assert.equal(f.inserted.length,0);
  }
});
test("signature must match an independently pinned public key",async()=>{
  for(const mods of [
    {signer:fakeSigner(other.privateKey)},
    {signer:async()=>Buffer.alloc(64).toString("base64")},
    {trust:{publicKeySha256:"f".repeat(64)}},
    {trust:{roleName:"cst_team_onejob_subscriber_20261120_deadbeef"}},
  ]){
    const f=fixture();
    await assert.rejects(consumeOneCstDevCompletionOnce({
      client:f.db,scope,trustedSubscriber:{...trust,...mods.trust},now,
      signPayload:mods.signer||fakeSigner(),
    }),/CST_SUBSCRIBER_/);
    assert.equal(f.inserted.length,0);
  }
});
test("duplicate persistent receipt is rejected rather than counted delivered",async()=>{
  const f=fixture({insertionError:Object.assign(Error("unique"),{code:"23505"})});
  await assert.rejects(
    consumeOneCstDevCompletionOnce({
      client:f.db,scope,trustedSubscriber:trust,now,signPayload:fakeSigner(),
    }),/CST_SUBSCRIBER_DUPLICATE_RECEIPT_REJECTED/);
  assert.equal(f.inserted.length,0);
});
test("consumer is inert at import and cannot dispatch, sign or alter events",()=>{
  const src=readFileSync(new URL("./cst-team-onejob-subscriber-consumer-qa.mjs",import.meta.url),"utf8");
  assert.doesNotMatch(src,/generateKeyPairSync|createPrivateKey|sign as/);
  assert.doesNotMatch(src,/child_process|from "pg"|from "@workspace\/db"/);
  assert.doesNotMatch(src,/\bfetch\(|\bexecFile\(|\bspawn\(/);
  assert.doesNotMatch(src,/\bUPDATE\b.*\bai_events\b/i);
  assert.ok(src.includes("subscriberDeliveryVerified:false"));
  assert.ok(src.includes("independentFinalAckVerified:false"));
});

test("network-none PG16 functional harness cannot access real Supabase",()=>{
  const root=new URL("./",import.meta.url);
  const read=name=>readFileSync(new URL(name,root),"utf8");
  const driver=read("cst-team-onejob-subscriber-functional-rls-qa.py");
  const client=read("cst-team-onejob-subscriber-functional-client-qa.mjs");
  const reviewer=read("cst-team-onejob-subscriber-functional-review-qa.mjs");
  const signer=read("cst_team_onejob_signer_sidecar_qa.py");
  assert.match(driver,/--network","none"/);
  assert.match(driver,/POSTGRES_HOST_AUTH_METHOD=scram-sha-256/);
  assert.match(driver,/POSTGRES_INITDB_ARGS=--auth-local=scram-sha-256/);
  assert.doesNotMatch(driver,/POSTGRES_HOST_AUTH_METHOD=trust/);
  assert.match(driver,/SUBSCRIBER_SECRET=secrets\.token_hex\(32\)/);
  assert.match(client,/PG16_WRONG_SCRAM_PASSWORD_REJECTED/);
  assert.match(client,/error\?\.code!=="28P01"/);
  assert.match(driver,/type=bind,source=/);
  assert.match(driver,/docker","rm","-f"/);
  assert.match(driver,/shutil\.rmtree\(temp,ignore_errors=True\)/);
  assert.doesNotMatch(driver,/--network","host"/);
  assert.doesNotMatch(driver,/--privileged/);
  assert.doesNotMatch(driver,/SUPABASE_DEV_DATABASE_URL|nzdweipzckfszczzqtuw/);
  assert.match(client,/CST_ONEJOB_PG16_DISPOSABLE_QA/);
  assert.match(client,/cst_onejob_subscriber_functional_fixture/);
  assert.match(client,/host:QA_HOST,port:5432,database:QA_DB,user:QA_ROLE/);
  assert.match(client,/PG16_DUPLICATE_SIGNED_RECEIPT_REJECTED/);
  assert.match(reviewer,/CST_ONEJOB_PG16_DISPOSABLE_QA/);
  assert.match(reviewer,/signedReceiptConsistent,true/);
  assert.match(reviewer,/subscriberDeliveryVerified,false/);
  assert.match(reviewer,/independentFinalAckVerified,false/);
  assert.match(driver,/POSTGRES_HOST_AUTH_METHOD=scram-sha-256/);
  assert.match(driver,/--auth-local=scram-sha-256/);
  assert.match(driver,/subscriber-password/);
  assert.match(driver,/signer-secrets/);
  assert.match(driver,/os\.chown\(private,28510,28501\)/);
  assert.match(driver,/--reuid=28510/);
  assert.match(driver,/--bounding-set=-all/);
  assert.match(driver,/BAD_UID_SIGNING_DENIED/);
  assert.match(driver,/QA_SIGNER_SIGNED_TWO_BOUNDED_PAYLOADS_PASS/);
  assert.match(client,/PG16_WRONG_SCRAM_PASSWORD_REJECTED/);
  assert.match(client,/signUsingIndependentSidecar/);
  assert.match(client,/\/qa-sign\/sign\.sock/);
  assert.doesNotMatch(client,/receipt-private\.pem|createPrivateKey|readFileSync\(.*private/);
  assert.match(signer,/socket\.SO_PEERCRED/);
  assert.match(signer,/uid!=28502\s+or\s+gid!=28501/);
  assert.match(signer,/os\.geteuid\(\)!=28510/);
  assert.match(signer,/serv(?:ed|e)<2/);
  assert.doesNotMatch(signer,/supabase\.com|SUPABASE_PROD_DATABASE_URL|nzdweipzckfszczzqtuw/);
});
