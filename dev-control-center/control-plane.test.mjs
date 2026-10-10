import test from "node:test";
import assert from "node:assert/strict";
import { validateSeparation } from "./control-plane.mjs";
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
