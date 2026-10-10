import test from "node:test";
import assert from "node:assert/strict";
import { validateSeparation, canApproveRelease } from "./policy.mjs";
const dev={environment:"dev",databaseId:"db-dev",credentialId:"key-dev",namespace:"dev",storageBucket:"bucket-dev"};
const prod={environment:"prod",databaseId:"db-prod",credentialId:"key-prod",namespace:"prod",storageBucket:"bucket-prod"};
test("distinct identities are potentially safe, subject to independent verification",()=>{
 assert.deepEqual(validateSeparation(dev,prod),{safe:true,issues:[]});
});
test("shared database fails closed",()=>{
 const result=validateSeparation(dev,{...prod,databaseId:"db-dev"});
 assert.equal(result.safe,false);assert.ok(result.issues.includes("shared_databaseId"));
});
test("shared credentials fail closed",()=>{
 const result=validateSeparation(dev,{...prod,credentialId:"key-dev"});
 assert.equal(result.safe,false);assert.ok(result.issues.includes("shared_credentialId"));
});
test("missing infrastructure IDs fail closed",()=>{
 assert.equal(validateSeparation({},{}).safe,false);
});
test("environment crossover fails closed",()=>{
 assert.equal(validateSeparation({...dev,environment:"prod"},prod).safe,false);
});

test("release requires real security and required checks", () => {
 const base={isolation:validateSeparation(dev,prod),verifiedAt:"2026-10-10T00:00:00Z",gates:{allRequiredPassed:true,securityPassed:true,productionTargetVerified:true},commitSha:"a".repeat(40),environment:"production",confirmation:"APPROVE_PRODUCTION"};
 assert.equal(canApproveRelease(base),true);
 assert.equal(canApproveRelease({...base,gates:{...base.gates,securityPassed:false}}),false);
 assert.equal(canApproveRelease({...base,isolation:{safe:false}}),false);
 assert.equal(canApproveRelease({...base,verifiedAt:null}),false);
 assert.equal(canApproveRelease({...base,commitSha:"main"}),false);
 assert.equal(canApproveRelease({...base,confirmation:""}),false);
});
