import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessGpt02TaskLineage as assess} from './gpt02-task-lineage-ownership.mjs';
test('historical command with null task IDs and no human review is not assigned',()=>{
 const r=assess({codingTaskId:null,codingTaskExists:false,codingRunCount:0,humanReviewObserved:false},
  {aiTaskId:null,aiTaskExists:false,tenant:'default',assigneePresent:false});
 assert.equal(r.sourceTaskObserved,false);assert.equal(r.receiverTaskObserved,false);
 assert.equal(r.accountableOwnerVerified,false);assert.equal(r.releaseDecision,'NO_GO');
});
test('both existing independent tasks with assignee and reviewer cannot self-certify cross-system linkage',()=>{
 const r=assess({codingTaskId:'c43000bf-c952-4e91-9344-02d9256f9768',codingTaskExists:true,
  codingRunCount:2,humanReviewObserved:true,humanReviewerPresent:true},
  {aiTaskId:42,aiTaskExists:true,tenant:'default',assigneePresent:true});
 assert.equal(r.sourceTaskObserved,true);assert.equal(r.receiverTaskObserved,true);
 assert.equal(r.codingRunObserved,true);assert.equal(r.receiverAssigneeObserved,true);
 assert.equal(r.reviewerObserved,true);assert.equal(r.taskBindingVerified,false);
 assert.equal(r.attemptBindingVerified,false);assert.equal(r.accountableOwnerVerified,false);
 assert.equal(r.mayAssign,false);assert.equal(r.mayDispatchWorker,false);
});
test('wrong tenant, invalid IDs and missing records fail closed',()=>{
 for(const [core,hub] of [
  [{codingTaskId:'42',codingTaskExists:true},{aiTaskId:42,aiTaskExists:true,tenant:'default'}],
  [{codingTaskId:'c43000bf-c952-4e91-9344-02d9256f9768',codingTaskExists:false},{aiTaskId:42,aiTaskExists:true,tenant:'default'}],
  [{codingTaskId:null},{aiTaskId:42,aiTaskExists:true,tenant:'other'}],
  [{codingTaskId:null},{aiTaskId:'42',aiTaskExists:true,tenant:'default'}],
 ]){
  const r=assess(core,hub);
  assert.equal(r.taskBindingVerified,false);assert.equal(r.accountableOwnerVerified,false);
  assert.equal(r.releaseDecision,'NO_GO');
 }
});
