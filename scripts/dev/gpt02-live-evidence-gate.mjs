#!/usr/bin/env node
/**
 * GPT02 real DEV lifecycle E2E evidence gate. Offline, read-only, NO-GO by
 * design unless independently attested evidence is supplied and verified.
 * This validator intentionally DOES NOT accept self-asserted 'pass' fields,
 * JSON bundles, operator flags, or synthetic isolated test outputs as proof.
 * To authorize deployment a separately reviewed online verifier must examine
 * live DEV database readbacks, trusted operator sessions, worker native ACKs,
 * job event lineage and sign its own verification. NOT implemented here.
 */
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';

export const REQUIRED_LIVE_EVIDENCE=Object.freeze([
 {id:'job_intake',description:'Authenticated AI Task Center job, owner, assignee and immutable attempt ID'},
 {id:'command_lineage',description:'Correlated new nonterminal DEV command and exact worker ID; no terminal command reopened'},
 {id:'native_checkpoint',description:'Verified native signed checkpoint receipt bound to the attempt and worker'},
 {id:'native_receiver_ack',description:'Verified native receiver ACK for the same command and checkpoint'},
 {id:'latest_blocker',description:'Fresh latest BLOCKER with complete ordered response history and no terminal event'},
 {id:'operator_review',description:'Authenticated owner/admin session, signed intent, freshness and durable nonce evidence'},
 {id:'writer_attestation',description:'Independent trusted writer and attestor identity with secret custody and audit readback'},
 {id:'grant_and_lease',description:'Real authorized grant and exclusively claimed monotonic fenced lease'},
 {id:'worker_completion',description:'Native worker execution with exact fence, ACK, real result and idempotent completion'},
 {id:'task_center_monitoring',description:'Same job/attempt/command timeline, owner, assignee, progress and human escalation'},
 {id:'rollback_and_privileges',description:'DEV credential isolation, negative privilege checks, rollback and audit retention'},
]);
export function evaluateLiveEvidence(candidate){
 // A document supplied by an operator can identify expected evidence only.
 // It is not a substitute for independently authenticated live readback.
 const expected=REQUIRED_LIVE_EVIDENCE.map(({id,description})=>({
  id,description,verified:false,reason:'INDEPENDENT_LIVE_VERIFIER_NOT_IMPLEMENTED',
 }));
 const shape= candidate && typeof candidate==='object' && !Array.isArray(candidate) &&
  Object.keys(candidate).every(k=>['schemaVersion','environment','jobId','attemptId','commandId','notes'].includes(k)) &&
  candidate.schemaVersion===1 && candidate.environment==='DEV';
 const blockers=shape ? [] : ['INVALID_OR_UNTRUSTED_EVIDENCE_METADATA'];
 return {
  scope:'GPT02_DEV_LIVE_RELEASE',
  metadataAcceptable:!!shape,
  releaseDecision:'NO_GO',
  maySign:false,mayIssueGrant:false,mayDispatchWorker:false,mayCloseJob:false,
  checks:expected,blockers:[...blockers,'INDEPENDENT_LIVE_ATTESTATION_MISSING'],
  warning:'Synthetic tests or user-authored JSON never grant execution permission',
 };
}
function main(){
 const argv=process.argv.slice(2);
 if(argv.length>2||argv[0]==='--help'){
  process.stdout.write('Usage: node scripts/dev/gpt02-live-evidence-gate.mjs [--candidate path.json]\n');return;
 }
 let candidate=null;
 if(argv[0]==='--candidate'){
  if(argv.length!==2){process.stderr.write('Missing candidate path\n');process.exitCode=2;return;}
  try{
   const path=resolve(argv[1]);
   const input=readFileSync(path,'utf8');
   if(Buffer.byteLength(input)>16384)throw new Error('CANDIDATE_TOO_LARGE');
   candidate=JSON.parse(input);
  }catch{process.stderr.write('INVALID_CANDIDATE_FILE\n');process.exitCode=2;return;}
 }else if(argv.length){process.stderr.write('UNKNOWN_ARGUMENT\n');process.exitCode=2;return;}
 const output=evaluateLiveEvidence(candidate);
 process.stdout.write(JSON.stringify(output,null,2)+'\n');
 // Explicitly fail an external release gate, even if the metadata is correct.
 process.exitCode=3;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
