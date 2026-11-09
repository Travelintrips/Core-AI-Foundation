/** Read-only direct GPT02 attempt/command evidence; NEVER grants native execution. */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
export function assessDirectGpt02AttemptLineage(input){
 const core=obj(input?.core)?input.core:{};
 const hub=obj(input?.hub)?input.hub:{};
 const commandId=typeof input?.commandId==='string'&&UUID.test(input.commandId)?input.commandId:null;
 const taskId=Number.isSafeInteger(input?.taskId)&&input.taskId>0?input.taskId:null;
 const source=obj(core.command)?core.command:null;
 const execution=obj(hub.execution)?hub.execution:null;
 const sourceObserved=Boolean(commandId&&source?.id===commandId);
 const receiverObserved=Boolean(taskId&&execution?.task_id===taskId&&
   execution?.company_id==='default'&&execution?.source==='AI_TASK');
 const directCommandReferenceMatched=Boolean(sourceObserved&&receiverObserved&&execution.command_id===commandId);
 const coreTaskIdPresent=Boolean(sourceObserved&&typeof source.task_id==='string'&&UUID.test(source.task_id));
 const ownerIdPresent=Boolean(receiverObserved&&Number.isSafeInteger(execution.assigned_to_id)&&execution.assigned_to_id>0);
 const bindingTablesPresent=Boolean(core?.binding_table_present===true&&core?.nonce_table_present===true&&
   hub?.binding_table_present===true&&hub?.nonce_table_present===true);
 const nativeAckRecorded=Boolean(receiverObserved&&execution.final_ack_verified===true);
 const attestationRecorded=Boolean(receiverObserved&&execution.attestation_verified===true);
 const failed=source?.status==='FAILED'||execution?.status==='failed';
 const reasons=[];
 if(!sourceObserved)reasons.push('CORE_COMMAND_NOT_OBSERVED');
 if(!receiverObserved)reasons.push('DIRECT_EXECUTION_NOT_OBSERVED');
 if(!directCommandReferenceMatched)reasons.push('COMMAND_REFERENCE_NOT_MATCHED');
 if(!coreTaskIdPresent)reasons.push('CORE_TASK_ID_MISSING');
 if(!ownerIdPresent)reasons.push('ACCOUNTABLE_OWNER_ID_MISSING');
 if(!bindingTablesPresent)reasons.push('NATIVE_BINDING_SCHEMA_MISSING');
 if(!attestationRecorded)reasons.push('NATIVE_ATTESTATION_UNVERIFIED');
 if(!nativeAckRecorded)reasons.push('NATIVE_FINAL_ACK_UNVERIFIED');
 if(failed)reasons.push('TERMINAL_FAILURE');
 reasons.push('INDEPENDENT_NATIVE_PROVENANCE_NOT_ATTESTED');
 return {taskId,commandId,
   executionId:receiverObserved&&UUID.test(execution.id)?execution.id:null,
   sourceObserved,receiverObserved,directCommandReferenceMatched,
   coreTaskIdPresent,ownerIdPresent,bindingTablesPresent,
   attestationRecorded,nativeAckRecorded,failed,
   checks:reasons,referenceObservedNotAttested:directCommandReferenceMatched,
   mayPersistBinding:false,mayIssueGrant:false,mayDispatchWorker:false,
   mayResume:false,mayCloseJob:false,releaseDecision:'NO_GO'};
}
if(process.argv[1]?.endsWith('gpt02-direct-attempt-lineage-readonly.mjs')){
 let body='';
 for await(const part of process.stdin){body+=part;if(body.length>16384){process.stderr.write('OVERSIZE_READBACK\n');process.exit(2)}}
 try{
  const output=assessDirectGpt02AttemptLineage(JSON.parse(body));
  process.stdout.write(JSON.stringify(output,null,2)+'\n');
  if(!output.directCommandReferenceMatched)process.exitCode=3;
 }catch{process.stderr.write('INVALID_READBACK\n');process.exitCode=2}
}
