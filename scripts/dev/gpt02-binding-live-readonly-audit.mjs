/** Combines *independently acquired* sanitized Core and Hub read-only records.
 * Does not connect, claim cryptographic provenance or authorize a writer.
 */
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x);
export function auditLiveBindingPrerequisites({source,receiver},commandId){
 const idValid=typeof commandId==='string'&&uuid.test(commandId);
 const c=plain(source)&&source.system==='AI_CORE_DEV'&&source.command;
 const h=plain(receiver)&&receiver.system==='AI_TASK_DEV'&&receiver.receiver;
 const sourceObserved=Boolean(idValid&&c&&source.command.id===commandId);
 const receiverObserved=Boolean(idValid&&h&&receiver.receiver.external_id==='bridge-command:'+commandId);
 const sameIdentity=sourceObserved&&receiverObserved;
 const taskLinkMissing=sourceObserved&&receiverObserved&&source.command.task_id==null&&receiver.receiver.task_id==null;
 const terminalFailed=Boolean(sameIdentity&&String(source.command.status).toUpperCase()==='FAILED'&&
  String(receiver.receiver.status).toUpperCase()==='FAILED');
 const reportedProgress=receiverObserved&&Number.isInteger(receiver.receiver.progress)?receiver.receiver.progress:null;
 const sourceBindingAbsent=source?.proposedTables?.binding==null&&source?.proposedTables?.nonce==null;
 const receiverBindingAbsent=receiver?.proposedTables?.binding==null&&receiver?.proposedTables?.nonce==null;
 const checks=[
  {id:'core_command',state:sourceObserved?'OBSERVED':'NOT_VERIFIED'},
  {id:'receiver_external_command',state:receiverObserved?'OBSERVED':'NOT_VERIFIED'},
  {id:'failed_terminal_consistency',state:terminalFailed?'OBSERVED':'NOT_VERIFIED'},
  {id:'source_and_hub_task_linkage',state:'NOT_VERIFIED'},
  {id:'operator_identity',state:'NOT_VERIFIED'},
  {id:'attempt_identity',state:'NOT_VERIFIED'},
  {id:'native_worker_completion',state:'NOT_VERIFIED'},
  {id:'binding_and_nonce_deployment',state:'NOT_VERIFIED'},
 ];
 return {commandId:idValid?commandId:null,sourceObserved,receiverObserved,sameIdentity,
  taskLinkMissing,terminalFailed,receiverReportedProgress:reportedProgress,
  reportedProgressProvesCompletion:false,
  sourceBindingAbsent,receiverBindingAbsent,sourceHubBindingVerified:false,
  accountableOwnerVerified:false,attemptVerified:false,nativeCompletionVerified:false,
  mayPersistBinding:false,mayIssueGrant:false,mayDispatchWorker:false,mayCloseJob:false,
  checks,releaseDecision:'NO_GO'};
}
if(process.argv[1]?.endsWith('gpt02-binding-live-readonly-audit.mjs')){
 let payload='';
 for await(const chunk of process.stdin){payload+=chunk;if(payload.length>16384){process.stderr.write('AUDIT_INPUT_TOO_LARGE\n');process.exit(2);}}
 try{const parsed=JSON.parse(payload);const result=auditLiveBindingPrerequisites(parsed,parsed.commandId);
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  if(!result.sameIdentity)process.exitCode=3;
 }catch{process.stderr.write('AUDIT_INVALID_JSON\n');process.exitCode=2;}
}
