/**
 * DISPOSABLE, TEST-ONLY isolated verifier subprocess.
 * No sockets, HTTP, RPC, daemon, Supabase or production credential support.
 * Production deployment and real review writes are explicitly NO-GO.
 *
 * The caller supplies only a signed proof via stdin. This child owns the
 * application Ed25519 verification contract and test-only Postgres login
 * details. No caller-supplied SQL, role name or database URL is accepted.
 */
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {createIsolatedDevReviewWriterContract}
 from "../services/jobLifecycleReviewWriterServiceContract.js";

const refusal={recorded:false,reason:"ISOLATED_VERIFIER_CHILD_UNAVAILABLE",
 mayIssueGrant:false,mayDispatchWorker:false};
function reply(result:unknown){process.stdout.write(JSON.stringify(result)+"\n");}
if(process.env["APP_ENV"]!=="development"||process.env["NODE_ENV"]!=="test"||
   process.env["GPT02_SYNTHETIC_WRITER_CHILD_TEST_ONLY"]!=="true"){
 reply(refusal);process.exit(2);
}
const container=process.env["GPT02_SYNTHETIC_WRITER_CONTAINER"];
const publicKey=process.env["GPT02_SYNTHETIC_WRITER_PUBLIC_KEY"];
if(!container||!/^gpt02-evidence-fence-[0-9]+$/.test(container)||!publicKey){
 reply(refusal);process.exit(2);
}
try{
 const body=readFileSync(0,"utf8");
 if(Buffer.byteLength(body,"utf8")>8_192)throw new Error("TOO_LARGE");
 const request:unknown=JSON.parse(body);
 const contract=createIsolatedDevReviewWriterContract({
  appEnv:"development",nodeEnv:"test",publicKeyDerBase64:publicKey,
  now:()=>new Date(Date.now()+
   (process.env["GPT02_SYNTHETIC_EXPIRED_TEST_ONLY"]==="true"?61_000:0)),
  verifiedWriterAdapter:async proof=>{
   // This intentionally uses only the Docker-contained test credential. It
   // is NOT a deployable credential custody implementation.
   const encoded=Buffer.from(JSON.stringify(proof),"utf8").toString("base64");
   const query="SELECT isolated.try_append(1,7,10,11,convert_from(decode('"+
    encoded+"','base64'),'UTF8')::jsonb)";
   const output=execFileSync("docker",[
    "exec","-e","PGPASSWORD=isolated-verifier-credential",container,
    "psql","-h","127.0.0.1","-U","verifier_login","-d","postgres",
    "-v","ON_ERROR_STOP=1","-qAt","-c",query,
   ],{encoding:"utf8",timeout:15_000,maxBuffer:8_192});
   return output.trim().split("\n").at(-1)==="t";
  },
 });
 const response=await contract(request as {proof:unknown});
 reply(response);
}catch{
 reply(refusal);process.exit(2);
}
