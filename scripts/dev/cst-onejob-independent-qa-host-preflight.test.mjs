import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
const code=readFileSync(new URL("./cst-onejob-independent-qa-host-preflight.mjs",import.meta.url),"utf8");
const trustCode=readFileSync(new URL("./cst-onejob-qa-trust-custody.mjs",import.meta.url),"utf8");

test("host QA preflight rejects caller-selected trust manifest",()=>{
 assert.match(code,/process\.argv\.length!==4/);
 assert.match(code,/EXACT_TWO_INPUTS_REQUIRED_TRUST_PIN_IS_FIXED/);
 assert.match(code,/readRootOwnedQaPublicTrust\(\)/);
 assert.match(code,/queueTransitionAuthorized:false/);
 const p=spawnSync(process.execPath,[
  "scripts/dev/cst-onejob-independent-qa-host-preflight.mjs",
  "/tmp/receipt.json","/tmp/expected.json","/tmp/caller-trust.json"
 ],{encoding:"utf8",timeout:10000});
 assert.equal(p.status,2,p.stderr+" "+p.stdout);
 const result=JSON.parse(p.stdout);
 assert.equal(result.status,"DENIED");
 assert.ok(result.reasons.includes("EXACT_TWO_INPUTS_REQUIRED_TRUST_PIN_IS_FIXED"));
 assert.equal(result.dispatchPermitted,false);
});
test("host trust has nofollow, root-owned ancestor and same-fd readback",()=>{
 assert.match(trustCode,/constants\.O_NOFOLLOW/);
 assert.match(trustCode,/fstatSync\(fd\)/);
 assert.match(trustCode,/readFileSync\(fd/);
 assert.match(trustCode,/for\(const dir of \["\/etc","\/etc\/cst-onejob-qa",CST_QA_TRUST_DIR\]\)/);
 assert.match(trustCode,/file\.nlink!==1/);
 assert.match(trustCode,/closeSync\(fd\)/);
});
test("no operational QA signing, DB mutation, queueing or final ACK",()=>{
 for(const s of [code,trustCode]){
   assert.doesNotMatch(s,/generateKeyPairSync|createPrivateKey|INSERT INTO|UPDATE ai_platform|CREATE ROLE|router\.post|queueTransitionAuthorized:true|dispatchPermitted:true/);
 }
});
