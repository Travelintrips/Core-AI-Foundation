/** Standalone, no-auth, no-deploy QA Docker image provenance gate.
 * Reads only the image metadata and its build marker through a no-network cat.
 * No application starts, no databases, no roles, no task dispatch.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function evaluateOneJobImage({expectedSha,sourceLabel,marker,scope,prodDeploy,imageId}) {
  const blockers=[];
  const reject=(ok,name)=>{if(!ok)blockers.push(name)};
  reject(/^[a-f0-9]{40}$/.test(expectedSha||""),"EXPECTED_SOURCE_SHA_INVALID");
  reject(/^sha256:[a-f0-9]{64}$/.test(imageId||""),"IMAGE_ID_MISSING");
  reject(/^DEV[_A-Z0-9]*ONEJOB[_A-Z0-9]*$/.test(scope||""),"NOT_DEV_ONEJOB_IMAGE");
  reject(prodDeploy==="false","PROD_DEPLOY_FLAG_NOT_FALSE");
  reject(sourceLabel===expectedSha,"IMAGE_SOURCE_LABEL_MISMATCH");
  reject(marker===expectedSha,"EMBEDDED_BUILD_SHA_MISMATCH");
  return {check:"CST_ONEJOB_IMAGE_PROVENANCE",verified:blockers.length===0,
    blockers,sideEffects:"NO_DB_NO_CREDENTIALS_NO_DEPLOY"};
}

function readImage(tag) {
  const format='{{.Id}}|{{index .Config.Labels "cst.qa.source_commit"}}|'+
    '{{index .Config.Labels "cst.qa.scope"}}|{{index .Config.Labels "cst.qa.prod_deploy"}}';
  const info=execFileSync("docker",["image","inspect",tag,"--format",format],
    {encoding:"utf8",timeout:10000}).trim().split("|");
  const marker=execFileSync("docker",["run","--rm","--network","none",
    "--entrypoint","cat",tag,"/app/.cst-build-sha"],
    {encoding:"utf8",timeout:15000}).trim();
  return {imageId:info[0],sourceLabel:info[1],scope:info[2],
    prodDeploy:info[3],marker};
}
const isMain=process.argv[1] &&
  resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(isMain){
  const [tag,expectedSha]=process.argv.slice(2);
  const allowedTag=/^core-ai-dev:cst-onejob-[a-f0-9]{8}-qa$/;
  if(!allowedTag.test(tag||"") || !/^[a-f0-9]{40}$/.test(expectedSha||"")){
    console.log(JSON.stringify({verified:false,blockers:["INVALID_IMAGE_TAG_OR_SHA"]}));
    process.exitCode=2;
  } else {
    try{
      const v=evaluateOneJobImage({expectedSha,...readImage(tag)});
      console.log(JSON.stringify(v));if(!v.verified)process.exitCode=2;
    }catch(e){
      console.log(JSON.stringify({verified:false,
        blockers:["IMAGE_INSPECTION_UNAVAILABLE"],errorType:e.name}));
      process.exitCode=2;
    }
  }
}
