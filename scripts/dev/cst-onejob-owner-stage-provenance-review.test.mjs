import test from "node:test";
import assert from "node:assert/strict";
import {evaluateOwnerStageProvenance} from "./cst-onejob-owner-stage-provenance-review.mjs";
const E="e5f1643ac998c6457a1961fb017d3b9cffe834d1";
const D="d3cd194b264390e702decc4def6e103602b88f97";
const unit=()=>"[Service]\nEnvironmentFile=/etc/cst-onejob-dev/bootstrap-verified/owner-stage-public.env\nExecStart=/usr/bin/docker run --rm ${CST_ONEJOB_STAGE_IMAGE_REF} /run/cst-stage-entrypoint.sh\n";
const config=(source,image)=>"CST_TEAM_DEV_APPROVED_SOURCE_SHA="+source+"\nCST_ONEJOB_STAGE_IMAGE_REF="+image+"\n";
const review=(source,image,u=unit())=>evaluateOwnerStageProvenance({unitText:u,publicConfigText:config(source,image)});
test("short historical image ref fails closed",()=>{
 assert.ok(review(E,"cst-onejob-stage-dev:d3cd194b").blockers.includes("EXACT_SHA_IMAGE_REF_MISSING_OR_INVALID"));
});
test("mismatched full source hashes fail closed",()=>{
 assert.ok(review(E,"cst-onejob-stage-dev:"+D).blockers.includes("IMAGE_REF_SOURCE_PIN_MISMATCH"));
});
test("matching source refs still return NO_GO pending image digest and authorization",()=>{
 const r=review(E,"cst-onejob-stage-dev:"+E);
 assert.deepEqual(r.blockers,["IMAGE_DIGEST_AND_EMBEDDED_SHA_NOT_INDEPENDENTLY_ATTESTED","SIGNED_OPERATIONAL_RELEASE_NOT_VERIFIED"]);
 assert.equal(r.releaseDecision,"NO_GO");
 for(const k of ["ownerApprovalPermitted","queueTransitionAuthorized","dispatchPermitted","signerActivationPermitted","finalAckIssued"]) assert.equal(r[k],false);
});
test("missing or duplicate source and image references fail closed",()=>{
 for(const text of ["",config(E,"cst-onejob-stage-dev:"+E)+config(D,"cst-onejob-stage-dev:"+D)]){
  const r=evaluateOwnerStageProvenance({unitText:unit(),publicConfigText:text});
  assert.ok(r.blockers.includes("PUBLIC_SOURCE_PIN_MISSING_OR_INVALID"));
  assert.ok(r.blockers.includes("EXACT_SHA_IMAGE_REF_MISSING_OR_INVALID"));
 }
});
test("unit must consume the configured image ref exactly once",()=>{
 for(const bad of [unit()+unit(),unit().replace("${CST_ONEJOB_STAGE_IMAGE_REF}","cst-onejob-stage-dev:"+E),unit().replace("EnvironmentFile=","# EnvironmentFile="),unit().replace(" ${CST_ONEJOB_STAGE_IMAGE_REF} /run"," ${CST_ONEJOB_STAGE_IMAGE_REF} ${CST_ONEJOB_STAGE_IMAGE_REF} /run")]){
  assert.ok(review(E,"cst-onejob-stage-dev:"+E,bad).blockers.includes("CANDIDATE_UNIT_IMAGE_CONFIG_BINDING_INVALID"));
 }
});
test("unexpected registry, tag, shell substitution or whitespace is rejected",()=>{
 for(const value of ["example.com/repo:"+E,"cst-onejob-stage-dev:latest","$(date)","cst-onejob-stage-dev:"+E+" extra"]){
  assert.ok(review(E,value).blockers.includes("EXACT_SHA_IMAGE_REF_MISSING_OR_INVALID"));
 }
});
