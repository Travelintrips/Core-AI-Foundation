import test from "node:test";
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync} from "node:crypto";
import {readFileSync} from "node:fs";
import {
  CST_QA_PINNED_TRUST_PATH,reviewQaTrustCustody
} from "./cst-onejob-qa-trust-custody.mjs";

const keys=generateKeyPairSync("ed25519");
const pub=keys.publicKey.export({type:"spki",format:"pem"}).toString();
const fingerprint=createHash("sha256").update(
 keys.publicKey.export({type:"spki",format:"der"})).digest("hex");
const trust={
 use:"CST_DEV_ONEJOB_QA_PUBLIC_PIN",
 project:"xssrfshdrtdfupgqwfdw",
 verifierId:"cst-independent-qa-reviewonly01",
 publicKeyPem:pub,fingerprint
};
const stat=(kind,uid=0,mode=kind==="file"?0o100644:0o40755,link=false)=>({
 uid,mode,isSymbolicLink:()=>link,
 isDirectory:()=>kind==="dir",isFile:()=>kind==="file"
});
const goodFile=stat("file"),goodDir=stat("dir");
const review=(file=goodFile,dir=goodDir,path=CST_QA_PINNED_TRUST_PATH,
 doc=trust)=>reviewQaTrustCustody(file,dir,path,CST_QA_PINNED_TRUST_PATH,doc);
function deny(report,code){
 assert.equal(report.status,"DENIED",JSON.stringify(report));
 assert.ok(report.blockers.includes(code),JSON.stringify(report));
 assert.equal(report.dispatchPermitted,false);
}
test("correctly pinned root-owned public key is custody preflight ONLY",()=>{
 const v=review();
 assert.equal(v.status,"CUSTODY_CHECK_ONLY");
 assert.equal(v.queueTransitionAuthorized,false);
 assert.equal(v.finalAckVerified,false);
});
test("reject caller-selected, writable, non-root or symbolic link trust",()=>{
 deny(review(goodFile,goodDir,"/tmp/qa/public-root.json"),"QA_TRUST_PATH_NOT_PINNED");
 deny(review(stat("file",1000),goodDir),"QA_TRUST_FILE_CUSTODY_INVALID");
 deny(review(stat("file",0,0o100666),goodDir),"QA_TRUST_FILE_CUSTODY_INVALID");
 deny(review(stat("file",0,0o100644,true),goodDir),"QA_TRUST_FILE_CUSTODY_INVALID");
 deny(review(goodFile,stat("dir",0,0o40777)),"QA_TRUST_DIRECTORY_CUSTODY_INVALID");
 deny(review(goodFile,stat("dir",1000)),"QA_TRUST_DIRECTORY_CUSTODY_INVALID");
});
test("reject unknown project, untrusted verifier and forged public key",()=>{
 deny(review(goodFile,goodDir,CST_QA_PINNED_TRUST_PATH,
    {...trust,project:"nzdweipzckfszczzqtuw"}),"QA_TRUST_MANIFEST_SHAPE_INVALID");
 deny(review(goodFile,goodDir,CST_QA_PINNED_TRUST_PATH,
    {...trust,verifierId:"core-worker"}),"QA_TRUST_MANIFEST_SHAPE_INVALID");
 deny(review(goodFile,goodDir,CST_QA_PINNED_TRUST_PATH,
    {...trust,fingerprint:"a".repeat(64)}),"QA_TRUST_PUBLIC_KEY_PIN_MISMATCH");
 deny(review(goodFile,goodDir,CST_QA_PINNED_TRUST_PATH,
    {...trust,unreviewedKey:true}),"QA_TRUST_MANIFEST_SHAPE_INVALID");
});
test("custody module contains no signing, DB calls or dispatch",()=>{
 const s=readFileSync(new URL("./cst-onejob-qa-trust-custody.mjs",import.meta.url),"utf8");
 assert.match(s,/\/etc\/cst-onejob-qa\/trust\/public-root\.json/);
 assert.match(s,/CUSTODY_CHECK_ONLY/);
 assert.doesNotMatch(s,/generateKeyPairSync|createPrivateKey|INSERT INTO|UPDATE ai_platform|CREATE ROLE|router\.post/);
});
