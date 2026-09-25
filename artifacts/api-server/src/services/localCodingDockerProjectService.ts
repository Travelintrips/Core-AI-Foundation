import { access, readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const COMPOSE_FILES = ["compose.yaml","compose.yml","docker-compose.yaml","docker-compose.yml"] as const;
const DOCKERFILES = ["Dockerfile","dockerfile"] as const;

export type DockerProjectKind = "docker-compose" | "dockerfile" | "none";
export interface DockerServiceDescriptor { name:string; hasBuild:boolean; hasImage:boolean; hasHealthcheck:boolean }
export interface DockerProjectProfile {
  kind:DockerProjectKind; root:string; composeFile:string|null; dockerfile:string|null;
  services:DockerServiceDescriptor[]; hasHealthcheck:boolean; safeVerificationCommands:string[];
  deploymentSupported:boolean; deploymentBlockReason:string|null; warnings:string[];
}
export interface DockerCommandResult {
  command:string; status:"PASSED"|"FAILED"|"BLOCKED"; exitCode:number|null; stdout:string; stderr:string; durationMs:number;
}
export interface DockerProjectInspection { profile:DockerProjectProfile; verification:DockerCommandResult[] }
export interface DockerCommandExecutor {
  (file:string,args:string[],options:{cwd:string;timeout:number;maxBuffer:number;env:NodeJS.ProcessEnv}):
  Promise<{stdout?:string|Buffer;stderr?:string|Buffer}>;
}

async function exists(root:string,path:string){try{await access(join(root,path));return true}catch{return false}}
async function firstExisting(root:string,candidates:readonly string[]){for(const c of candidates)if(await exists(root,c))return c;return null}

function parseComposeServices(content:string):DockerServiceDescriptor[]{
  const lines=content.split(/\r?\n/); let servicesIndent=-1; let inServices=false;
  const found:Array<{name:string;line:number;indent:number}>=[];
  for(let i=0;i<lines.length;i+=1){
    const raw=lines[i]; if(!raw.trim()||raw.trimStart().startsWith("#"))continue;
    const indent=raw.length-raw.trimStart().length; const trimmed=raw.trim();
    if(!inServices){if(/^services:\s*$/.test(trimmed)){inServices=true;servicesIndent=indent} continue}
    if(indent<=servicesIndent)break;
    if(/^[A-Za-z0-9_.-]+:\s*$/.test(trimmed)){
      if(found.length===0||indent===found[0].indent) found.push({name:trimmed.slice(0,-1),line:i,indent});
    }
  }
  return found.slice(0,40).map((entry,index)=>{
    const end=index+1<found.length?found[index+1].line:lines.length;
    const block=lines.slice(entry.line+1,end).join("\n");
    return {name:entry.name,hasBuild:/^\s*build\s*:/m.test(block),hasImage:/^\s*image\s*:/m.test(block),hasHealthcheck:/^\s*healthcheck\s*:/m.test(block)};
  });
}
function deploymentBlockReason(){return process.env["AI_CODING_DOCKER_DEPLOY_ENABLED"]==="true"?null:"AI_CODING_DOCKER_DEPLOY_ENABLED is not true; Docker deployment remains fail-closed."}

export async function inspectDockerProject(rootInput:string):Promise<DockerProjectProfile>{
  const root=resolve(rootInput); const info=await stat(root).catch(()=>null);
  if(!info?.isDirectory())throw new Error("Docker project root does not exist or is not a directory.");
  const composeFile=await firstExisting(root,COMPOSE_FILES); const dockerfile=await firstExisting(root,DOCKERFILES);
  const services=composeFile?parseComposeServices(await readFile(join(root,composeFile),"utf8")):[];
  const kind:DockerProjectKind=composeFile?"docker-compose":dockerfile?"dockerfile":"none";
  const warnings:string[]=[]; if(kind==="none")warnings.push("No Dockerfile or Compose file was detected.");
  if(composeFile&&services.length===0)warnings.push("Compose file was detected but no service names could be derived safely.");
  const safeVerificationCommands:string[]=[];
  if(composeFile)safeVerificationCommands.push(`docker compose -f ${composeFile} config --quiet`);
  if(dockerfile)safeVerificationCommands.push(`docker build --check -f ${dockerfile} .`);
  const block=deploymentBlockReason();
  return {kind,root,composeFile,dockerfile,services,hasHealthcheck:services.some(s=>s.hasHealthcheck),safeVerificationCommands,
    deploymentSupported:kind!=="none"&&block===null,deploymentBlockReason:kind==="none"?"No Docker project definition was detected.":block,warnings};
}
function normalizeOutput(v:unknown){return typeof v==="string"?v:Buffer.isBuffer(v)?v.toString("utf8"):""}
async function runDockerCommand(root:string,command:string,executor:DockerCommandExecutor):Promise<DockerCommandResult>{
  const compose=command.match(/^docker compose -f ([A-Za-z0-9_.-]+) config --quiet$/);
  const check=command.match(/^docker build --check -f ([A-Za-z0-9_.-]+) \.$/); let args:string[];
  if(compose)args=["compose","-f",compose[1],"config","--quiet"];
  else if(check)args=["build","--check","-f",check[1],"."];
  else return {command,status:"BLOCKED",exitCode:null,stdout:"",stderr:"Docker command is not allowlisted.",durationMs:0};
  const started=Date.now();
  try{
    const r=await executor("docker",args,{cwd:root,timeout:60000,maxBuffer:2*1024*1024,env:{PATH:process.env.PATH??"",HOME:process.env.HOME??"",CI:"1",DOCKER_BUILDKIT:"1"}});
    return {command,status:"PASSED",exitCode:0,stdout:normalizeOutput(r.stdout).slice(0,100000),stderr:normalizeOutput(r.stderr).slice(0,50000),durationMs:Date.now()-started};
  }catch(error){
    const e=error as Error&{code?:number;stdout?:unknown;stderr?:unknown};
    return {command,status:"FAILED",exitCode:typeof e.code==="number"?e.code:null,stdout:normalizeOutput(e.stdout).slice(0,100000),stderr:(normalizeOutput(e.stderr)||e.message).slice(0,50000),durationMs:Date.now()-started};
  }
}
export async function inspectAndVerifyDockerProject(rootInput:string,options:{trustedWorkspace?:boolean;executor?:DockerCommandExecutor}={}):Promise<DockerProjectInspection>{
  const profile=await inspectDockerProject(rootInput);
  if(options.trustedWorkspace!==true)return {profile,verification:profile.safeVerificationCommands.map(command=>({command,status:"BLOCKED",exitCode:null,stdout:"",stderr:"Docker verification is fail-closed until the workspace is explicitly trusted.",durationMs:0}))};
  const executor=options.executor??(async(file,args,execOptions)=>{const r=await execFileAsync(file,args,execOptions);return {stdout:r.stdout,stderr:r.stderr}});
  const verification:DockerCommandResult[]=[]; for(const command of profile.safeVerificationCommands)verification.push(await runDockerCommand(profile.root,command,executor));
  return {profile,verification};
}
export function dockerDeploymentPlan(profile:DockerProjectProfile):string[]{
  if(!profile.deploymentSupported)return [];
  if(profile.composeFile)return [`docker compose -f ${profile.composeFile} pull`,`docker compose -f ${profile.composeFile} build --pull`,`docker compose -f ${profile.composeFile} up -d --remove-orphans`,`docker compose -f ${profile.composeFile} ps`];
  if(profile.dockerfile){const image=basename(profile.root).replace(/[^a-z0-9_.-]+/gi,"-").toLowerCase()||"ai-coding-project";return [`docker build --pull -t ${image}:candidate -f ${profile.dockerfile} .`,"Deployment requires an explicit runtime adapter for Dockerfile-only projects."]}
  return [];
}
