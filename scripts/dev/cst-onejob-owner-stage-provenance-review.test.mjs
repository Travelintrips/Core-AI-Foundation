import test from "node:test";
import assert from "node:assert/strict";
import {evaluateOwnerStageProvenance} from "./cst-onejob-owner-stage-provenance-review.mjs";
const E="e5f1643ac998c6457a1961fb017d3b9cffe834d1";
const D="d3cd194b264390e702decc4def6e103602b88f97";
const unit=s=>"[Service]\nExecStart=/usr/bin/docker run --rm cst-onejob-stage-dev:"+s+" /run/cst-stage-entrypoint.sh\n";
const config=s=>"CST_TEAM_DEV_APPROVED_SOURCE_SHA="+s+"\n";

test("historical short image tag is rejected",()=>{
  const r=evaluateOwnerStageProvenance({unitText:unit("d3cd194b"),publicConfigText:config(E)});
  assert.equal(r.releaseDecision,"NO_GO");
  assert.ok(r.blockers.includes("EXACT_SHA_IMAGE_TAG_REQUIRED"));
});
test("two valid but differing source hashes are rejected",()=>{
  const r=evaluateOwnerStageProvenance({unitText:unit(D),publicConfigText:config(E)});
  assert.ok(r.blockers.includes("IMAGE_TAG_SOURCE_PIN_MISMATCH"));
});
test("matching full SHA is insufficient without image digest and signed authority",()=>{
  const r=evaluateOwnerStageProvenance({unitText:unit(E),publicConfigText:config(E)});
  assert.equal(r.releaseDecision,"NO_GO");
  assert.deepEqual(r.blockers,[
    "IMAGE_DIGEST_AND_EMBEDDED_SHA_NOT_INDEPENDENTLY_ATTESTED",
    "SIGNED_OPERATIONAL_RELEASE_NOT_VERIFIED"
  ]);
  for(const k of ["ownerApprovalPermitted","queueTransitionAuthorized",
     "dispatchPermitted","signerActivationPermitted","finalAckIssued"])
    assert.equal(r[k],false);
});
test("missing or repeated config source pin fails closed",()=>{
  for(const value of ["",config(E)+config(D)]){
    const r=evaluateOwnerStageProvenance({unitText:unit(E),publicConfigText:value});
    assert.ok(r.blockers.includes("PUBLIC_SOURCE_PIN_MISSING_OR_INVALID"));
  }
});
test("duplicate image references fail closed",()=>{
  const r=evaluateOwnerStageProvenance({unitText:unit(E)+unit(E),publicConfigText:config(E)});
  assert.ok(r.blockers.includes("EXACT_SHA_IMAGE_TAG_REQUIRED"));
});
