/**
 * Disposable PG16 network-none functional consumer test driver, NEVER an
 * operational CST-DEV subscriber or credential custodian. Local PG16 uses
 * ephemeral SCRAM-SHA-256 auth inside network-none QA. Real Supabase requires
 * pinned TLS, a dedicated login and separate operational authorization.
 */
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
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
const signer=createPrivateKey(readFileSync("/qa-secrets/receipt-private.pem"));
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
      signPayload:async bytes=>sign(null,bytes,signer).toString("base64"),
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
