/**
 * Read-only source/provenance gate for CST-DEV one-job Owner WAITING bootstrap.
 * No credentials, signer, database, Docker execution, service changes or release authority.
 */
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve,dirname} from "node:path";

const SHA=/^[a-f0-9]{40}$/;
const UNIT_PATH="deploy/cst-onejob-vps/owner-stage-bootstrap/cst-onejob-owner-stage-bootstrap.service.CANDIDATE";
const PUBLIC_CONFIG="/etc/cst-onejob-dev/bootstrap-verified/owner-stage-public.env";

export function evaluateOwnerStageProvenance({unitText,publicConfigText}){
  const blockers=[];
  const assignments=String(publicConfigText??"").split(/\r?\n/)
    .filter(line=>/^CST_TEAM_DEV_APPROVED_SOURCE_SHA=/.test(line.trim()));
  const pinned=assignments.length===1
    ?assignments[0].trim().split("=").slice(1).join("="):null;
  if(!pinned||!SHA.test(pinned))blockers.push("PUBLIC_SOURCE_PIN_MISSING_OR_INVALID");

  const matches=[...String(unitText??"").matchAll(/\bcst-onejob-stage-dev:([^\s]+?)(?=\s|$)/g)];
  const tag=matches.length===1?matches[0][1]:null;
  if(!tag||!SHA.test(tag))blockers.push("EXACT_SHA_IMAGE_TAG_REQUIRED");
  if(SHA.test(pinned??"")&&SHA.test(tag??"")&&pinned!==tag)
    blockers.push("IMAGE_TAG_SOURCE_PIN_MISMATCH");

  // Never infer an actual image digest, embedded stamp, custody or authorization
  // from a tag, local config or untrusted JSON boolean.
  blockers.push("IMAGE_DIGEST_AND_EMBEDDED_SHA_NOT_INDEPENDENTLY_ATTESTED");
  blockers.push("SIGNED_OPERATIONAL_RELEASE_NOT_VERIFIED");
  return {
    status:"DENIED",releaseDecision:"NO_GO",
    ownerApprovalPermitted:false,queueTransitionAuthorized:false,
    dispatchPermitted:false,signerActivationPermitted:false,finalAckIssued:false,
    evidence:{publicPinnedSourceSha:pinned,candidateImageTag:tag},
    blockers:[...new Set(blockers)]
  };
}

function main(){
  if(process.argv.slice(2).join(",")!=="--read-only"){
    process.stdout.write(JSON.stringify({status:"USAGE_DENIED",releaseDecision:"NO_GO",allowed:["--read-only"]})+"\n");
    process.exitCode=2;return;
  }
  const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
  let unitText="",publicConfigText="";
  try{unitText=readFileSync(resolve(root,UNIT_PATH),"utf8");}catch{/* deny */}
  try{publicConfigText=readFileSync(PUBLIC_CONFIG,"utf8");}catch{/* deny */}
  const report=evaluateOwnerStageProvenance({unitText,publicConfigText});
  process.stdout.write(JSON.stringify(report)+"\n");
  process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
