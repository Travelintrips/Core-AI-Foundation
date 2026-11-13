/** Passive cross-system task lineage diagnostics; never authorizes execution.
 * AI Core coding tasks use UUID; AI Task Hub tasks use integer identities.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validUUID=x=>typeof x==='string'&&UUID.test(x);
const validInt=x=>Number.isSafeInteger(x)&&x>0;
export function assessGpt02TaskLineage(core,hub){
 const sourceTaskObserved=validUUID(core?.codingTaskId)&&core?.codingTaskExists===true;
 const receiverTaskObserved=validInt(hub?.aiTaskId)&&hub?.aiTaskExists===true&&hub?.tenant==='default';
 const codingRunObserved=sourceTaskObserved&&validInt(core?.codingRunCount);
 const receiverAssigneeObserved=receiverTaskObserved&&hub?.assigneePresent===true;
 const humanReviewObserved=core?.humanReviewObserved===true;
 const reviewerObserved=humanReviewObserved&&core?.humanReviewerPresent===true;
 // A reviewer, coding run, or coincident task ID does not certify a job owner.
 // No persisted, independently verified Core UUID <-> Hub integer binding yet.
 const taskBindingVerified=false;
 const attemptBindingVerified=false;
 const accountableOwnerVerified=false;
 return {
  sourceTaskNamespace:'ai_platform.ai_coding_tasks.uuid',
  receiverTaskNamespace:'public.ai_tasks.integer',
  sourceTaskObserved,receiverTaskObserved,codingRunObserved,
  receiverAssigneeObserved,humanReviewObserved,reviewerObserved,
  taskBindingVerified,attemptBindingVerified,accountableOwnerVerified,
  checks:[
   {id:'core_coding_task',state:sourceTaskObserved?'OBSERVED':'NOT_VERIFIED'},
   {id:'hub_task',state:receiverTaskObserved?'OBSERVED':'NOT_VERIFIED'},
   {id:'core_run',state:codingRunObserved?'PRESENT_UNVERIFIED':'NOT_VERIFIED'},
   {id:'hub_assignee',state:receiverAssigneeObserved?'PRESENT_UNVERIFIED':'NOT_VERIFIED'},
   {id:'human_review',state:reviewerObserved?'PRESENT_UNVERIFIED':'NOT_VERIFIED'},
   {id:'cross_system_binding',state:'NOT_VERIFIED'},
   {id:'command_attempt_binding',state:'NOT_VERIFIED'},
   {id:'accountable_owner',state:'NOT_VERIFIED'},
  ],
  mayCreateTask:false,mayAssign:false,mayDispatchWorker:false,mayCloseJob:false,
  releaseDecision:'NO_GO',
 };
}
