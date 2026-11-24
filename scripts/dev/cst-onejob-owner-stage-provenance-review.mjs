/**
 * Read-only source/provenance gate for CST-DEV one-job Owner WAITING bootstrap.
 * Does not inspect credentials, execute Docker, alter services, issue authority or GO.
 */
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve,dirname} from "node:path";

const SHA=/^[a-f0-9]{40}$/;
const UNIT_PATH="deploy/cst-onejob-vps/owner-stage-bootstrap/cst-onejob-owner-stage-bootstrap.service.CANDIDATE";
const PUBLIC_CONFIG="/etc/cst-onejob-dev/bootstrap-verified/owner-stage-public.env";
const IMAGE_KEY="CST_ONEJOB_STAGE_IMAGE_REF";
const SOURCE_KEY="CST_TEAM_DEV_APPROVED_SOURCE_SHA";

function exactAssignment(text,key){
 const lines=String(text??"").split(/\r?\n/)
   .filter(x=>x.trim().startsWith(key+"="));
 if(lines.length!==1)return null;
 const val=lines[0].trim().slice(key.length+1);
 // No shell evaluation, substitutions, quotes, whitespace or extra commands.
 return /^[A-Za-z0-9_.:/@-]+$/.test(val)?val:null;
}

export function evaluateOwnerStageProvenance({unitText,publicConfigText}){
 const blockers=[];
 const source=exactAssignment(publicConfigText,SOURCE_KEY);
 const image=exactAssignment(publicConfigText,IMAGE_KEY);
 if(!SHA.test(source??""))blockers.push("PUBLIC_SOURCE_PIN_MISSING_OR_INVALID");
 const imageMatch=/^cst-onejob-stage-dev:([a-f0-9]{40})$/.exec(image??"");
 if(!imageMatch)blockers.push("EXACT_SHA_IMAGE_REF_MISSING_OR_INVALID");
 if(imageMatch&&SHA.test(source??"")&&imageMatch[1]!==source)
   blockers.push("IMAGE_REF_SOURCE_PIN_MISMATCH");
 const u=String(unitText??"");
 const executableLines=u.split(/\r?\n/).filter(x=>/^ExecStart=/.test(x));
 if(executableLines.length!==1 ||
    (executableLines[0].match(/\$\{CST_ONEJOB_STAGE_IMAGE_REF\}/g)||[]).length!==1 ||
    !executableLines[0].includes(" ${CST_ONEJOB_STAGE_IMAGE_REF} /run/cst-stage-entrypoint.sh") ||
    /cst-onejob-stage-dev:[a-f0-9]+/.test(executableLines[0]) ||
    u.split(/\r?\n/).filter(x=>x==="EnvironmentFile="+PUBLIC_CONFIG).length!==1)
   blockers.push("CANDIDATE_UNIT_IMAGE_CONFIG_BINDING_INVALID");
 // A public config string is not proof of image bytes, signature, custody or QA.
 blockers.push("IMAGE_DIGEST_AND_EMBEDDED_SHA_NOT_INDEPENDENTLY_ATTESTED");
 blockers.push("SIGNED_OPERATIONAL_RELEASE_NOT_VERIFIED");
 return {
   status:"DENIED",releaseDecision:"NO_GO",
   ownerApprovalPermitted:false,queueTransitionAuthorized:false,
   dispatchPermitted:false,signerActivationPermitted:false,finalAckIssued:false,
   evidence:{publicPinnedSourceSha:source,candidateImageRef:image},
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
