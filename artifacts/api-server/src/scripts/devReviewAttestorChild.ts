/** Disposable test-only independent persisted-audit attestor.
 * No live DB URLs, API port, review approval, grant or worker dispatch.
 * Input is ONLY a decimal audit ID. The process re-reads the persisted proof
 * from networkless Docker Postgres, verifies real Ed25519 and only then uses
 * the distinct test attestor SQL identity. Never deploy to CST-DEV or PROD.
 */
import {readFileSync} from "node:fs";
import {createHmac} from "node:crypto";
import {execFileSync} from "node:child_process";
import {verifyOperatorApprovalProof} from "../services/jobLifecycleOperatorApprovalProof.js";
const deny=()=>{process.stdout.write("ATTESTATION_DENIED\n");process.exit(3);};
const c=process.env["GPT02_SYNTHETIC_WRITER_CONTAINER"];
const key=process.env["GPT02_SYNTHETIC_WRITER_PUBLIC_KEY"];
const macKey=process.env["GPT02_SYNTHETIC_ATTESTOR_KEY_TEST_ONLY"];
if(process.env["APP_ENV"]!=="development"||process.env["NODE_ENV"]!=="test"||
 process.env["GPT02_SYNTHETIC_WRITER_CHILD_TEST_ONLY"]!=="true"||
 !c||!/^gpt02-evidence-fence-[0-9]+$/.test(c)||!key||
 !macKey||!/^[a-f0-9]{64}$/.test(macKey)||
 ["DATABASE_URL","SUPABASE_DEV_DATABASE_URL","OPENCLAW_AI_CORE_API_KEY","NODE_OPTIONS"].some(k=>process.env[k]!==undefined))deny();
try {
 const id=readFileSync(0,"utf8").trim();
 if(!/^[1-9][0-9]{0,8}$/.test(id))deny();
 // Both proof and its digest come from one SQL statement/snapshot.
 const query="SELECT replace(encode(convert_to(proof_json::text,'UTF8'),'base64'),chr(10),''),"+
  "md5(proof_json::text) FROM isolated.audit WHERE id="+id;
 const postgres=(user:string,password:string,sql:string)=>execFileSync("docker",[
  "exec","-e","PGPASSWORD="+password,c!,"psql","-h","127.0.0.1", "-U",user,"-d","postgres",
  "-qAt","-v","ON_ERROR_STOP=1","-c",sql],{encoding:"utf8",timeout:15000,maxBuffer:16384}).trim();
 // Test-only readback uses a dedicated non-superuser login with SELECT on
 // audit ID and proof only; no access to commands, roles or writes.
 const row=postgres("audit_reader_login","isolated-reader-credential",query);
 const pieces=row.split("|");
 if(pieces.length!==2||pieces[0]!.length>8192||
    !/^[A-Za-z0-9+/=]+$/.test(pieces[0]!)||
    !/^[a-f0-9]{32}$/.test(pieces[1]!))deny();
 const [raw,digest]=pieces as [string,string];
 const proof=JSON.parse(Buffer.from(raw,"base64").toString("utf8"));
 const verified=verifyOperatorApprovalProof({
  proof,expectedCommandId:"169a7492-cfd8-4a56-bb57-18001b6b5968",
  expectedCheckpointResponseId:"822efca2-7428-428a-ac66-548c0462438e",
  expectedBlockerResponseId:"08b7b237-7a16-46d0-b79d-029d0363c112",
  expectedWorkerId:"openclaw-dell-chatgpt-wake-dev",now:new Date(),
  serverPublicKeyDerBase64:key,
 });
 if(!verified.validForReview)deny();
 // The digest was read in the same snapshot as the verified proof.
 // The attestation procedure separately rechecks equality at insertion.
 const epoch=Math.floor(Date.now()/1000);
 const mac=createHmac("sha256",Buffer.from(macKey!,"hex"))
   .update(id+":"+digest+":"+epoch,"utf8").digest("hex");
 const accepted=postgres("attestor_login","isolated-attestor-credential",
  "SELECT isolated.attest_review("+id+",'"+digest+"',"+epoch+",'"+mac+"')");
 if(accepted!=="t")deny();
 process.stdout.write("PERSISTED_AUDIT_CRYPTO_ATTESTED_PASS\n");
}catch{deny();}
