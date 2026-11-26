/**
 * Disposable PG16 network-none functional consumer test driver, NEVER an
 * operational CST-DEV subscriber or credential custodian. Local PG16 uses
 * ephemeral SCRAM-SHA-256 auth inside network-none QA. Real Supabase requires
 * pinned TLS, a dedicated login and separate operational authorization.
 */
import { createHash, createPublicKey } from "node:crypto";
import { connect } from "node:net";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { consumeOneCstDevCompletionOnce } from "./cst-team-onejob-subscriber-consumer-qa.mjs";

const QA_DB="cst_onejob_subscriber_functional_fixture";
const QA_ROLE="cst_team_onejob_subscriber_20261120_abcdef12";
const QA_HOST="/var/run/postgresql";
const QA_SCOPE=Object.freeze({
  jobId:483,jobCode:"APPROVED-ONE",workerId:991,
  requestId:"cst-ai-team-company1-dev:pilot-"+"a".repeat(20),
});
const SID="cst-dev-onejob-subscriber-20261120-abcdef12";
const expectedMode=process.argv[2];
if(process.env.CST_ONEJOB_PG16_DISPOSABLE_QA!=="true" ||
   !["first","duplicate"].includes(expectedMode))throw Error("DISPOSABLE_QA_ONLY");
const routes=readFileSync("/proc/net/route","utf8").split("\n").slice(1);
if(routes.some(x=>x.trim().split(/\s+/)[1]==="00000000"))
  throw Error("DISPOSABLE_QA_HAS_OUTBOUND_IP_ROUTE");
const pem=readFileSync("/qa-secrets/receipt-public.pem","utf8");
const key=createPublicKey(pem);
const pin=createHash("sha256").update(
  key.export({type:"spki",format:"der"})).digest("hex");
// Key custody is isolated in a separate non-root SO_PEERCRED-gated signer.
if(readFileSync("/proc/net/route","utf8").split("\n").some(x=>
  x.trim().split(/\s+/)[1]==="00000000"))
  throw Error("QA_CLIENT_IPV4_ROUTE_FORBIDDEN");
async function signUsingIndependentSidecar(bytes) {
  return await new Promise((resolve,reject)=>{
    if(!Buffer.isBuffer(bytes) || bytes.length<256 || bytes.length>2000)
      return reject(Error("QA_SIGN_FRAME_INVALID"));
    const socket=connect({path:"/qa-sign/sign.sock"});
    const chunks=[];
    let count=0,finished=false;
    const finish=(err,result)=>{
      if(finished)return;
      finished=true;
      socket.destroy();
      if(err)reject(err); else resolve(result);
    };
    socket.setTimeout(3500);
    socket.once("connect",()=>{
      const header=Buffer.alloc(4);
      header.writeUInt32BE(bytes.length);
      socket.write(Buffer.concat([header,bytes]));
    });
    socket.on("data",chunk=>{
      count+=chunk.length;
      if(count>64)return finish(Error("QA_SIGNER_SIGNATURE_OVERFLOW"));
      chunks.push(chunk);
    });
    socket.once("end",()=>{
      if(count!==64)return finish(Error("QA_SIGNER_BAD_SIGNATURE_SIZE"));
      finish(null,Buffer.concat(chunks).toString("base64"));
    });
    socket.once("error",finish);
    socket.once("timeout",()=>finish(Error("QA_SIGNER_TIMEOUT")));
  });
}
const pg=createRequire("/app/lib/db/package.json")("pg");
const password=readFileSync("/qa-secrets/subscriber-password","utf8");
if(!/^[a-f0-9]{64}$/.test(password))throw Error("QA_SCRAM_PASSWORD_INVALID");
const connection={
  host:QA_HOST,port:5432,database:QA_DB,user:QA_ROLE,password,
  connectionTimeoutMillis:1800,query_timeout:2400,
  // Test-only Unix socket inside --network none PG16; not Supabase TLS.
  ssl:false,
};
// Prove the database rejects a bad password BEFORE using the true ephemeral
// credential. A Unix socket with permissive filesystem mode is not auth proof.
const wrong=new pg.Client({...connection,password:password+"BAD"});
try {
  await wrong.connect();
  throw Error("QA_WRONG_SCRAM_PASSWORD_ACCEPTED");
} catch(error) {
  if(error?.message==="QA_WRONG_SCRAM_PASSWORD_ACCEPTED" || error?.code!=="28P01")
    throw error;
  console.log("PG16_WRONG_SCRAM_PASSWORD_REJECTED");
} finally {await wrong.end().catch(()=>{});}
const client=new pg.Client(connection);
try {
  await client.connect();
  const database=await client.query("SELECT current_database() AS database_name");
  if(database.rows?.[0]?.database_name!==QA_DB)
    throw Error("DISPOSABLE_DATABASE_NOT_VERIFIED");
  let result;
  try {
    result=await consumeOneCstDevCompletionOnce({
      client,scope:QA_SCOPE,
      trustedSubscriber:{roleName:QA_ROLE,subscriberId:SID,
        publicKeyPem:pem,publicKeySha256:pin},
      now:new Date(),
      signPayload:signUsingIndependentSidecar,
    });
    if(expectedMode!=="first"||result.claimedInsertCount!==1)
      throw Error("UNEXPECTED_RECEIPT_INSERT");
    if(result.subscriberDeliveryVerified!==false||
       result.independentFinalAckVerified!==false)
      throw Error("DISPOSABLE_QA_MISLABELED_AS_LIVE");
    console.log(JSON.stringify({
      result:"PG16_AUTHENTICATED_ROLE_ONE_EVENT_SIGNED_RECEIPT_INSERTED",
      project:"DISPOSABLE_PG16_ONLY",claimedInsertCount:1,
      subscriberDeliveryVerified:false,independentFinalAckVerified:false,
    }));
  } catch(error) {
    if(expectedMode!=="duplicate"||
       error?.message!=="CST_SUBSCRIBER_DUPLICATE_RECEIPT_REJECTED")
      throw error;
    console.log("PG16_DUPLICATE_SIGNED_RECEIPT_REJECTED");
  }
} finally {
  await client.end().catch(()=>{});
}
