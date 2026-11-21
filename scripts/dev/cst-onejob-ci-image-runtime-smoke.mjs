#!/usr/bin/env node
/** Offline QA: boot actual matched API + UI inside GitHub Docker --network none.
 * No real database credentials, Owner session, signer, dispatch or PROD.
 */
import {spawn} from "node:child_process";
import {readFileSync} from "node:fs";
import {createServer} from "node:http";
import {createHash} from "node:crypto";
import {join} from "node:path";
import {setTimeout as sleep} from "node:timers/promises";

const guard=process.env.CST_ONEJOB_IMAGE_SMOKE_QA==="true" &&
  process.env.APP_ENV==="development" &&
  process.env.NODE_ENV==="development" &&
  process.env.AI_DISPATCHER_ENABLED==="false" &&
  process.env.OLLAMA_WORKER_RUNTIME_ENABLED==="false" &&
  process.env.CST_DEV_ONEJOB_OWNER_APPROVAL_ENABLED==="false" &&
  process.env.CST_DEV_ONEJOB_BROKER_ENABLED==="false" &&
  !process.env.SUPABASE_DATABASE_URL_PROD && !process.env.DATABASE_URL_PROD;
if(!guard){
 console.log("CI_RUNTIME_SMOKE_DENIED_INVALID_SCOPE");
 process.exit(2);
}
const expected=process.env.QA_SOURCE_SHA||"";
const actual=readFileSync("/app/.cst-build-sha","utf8").trim();
if(!/^[a-f0-9]{40}$/.test(expected)||expected!==actual){
 console.log("CI_RUNTIME_SMOKE_DENIED_SOURCE_MISMATCH");
 process.exit(2);
}
const local="http://127.0.0.1:3000";
const sha256=(b)=>createHash("sha256").update(b).digest("hex");
// The API's built-in SPA fallback is NOT the AI Platform UI. Real Nginx
// serves /var/www/dev-aicore while /api/ proxies to the Core API. Verify
// the compiled AI Platform's actual JS, not merely HTTP 200 from any SPA.
const aiUiRoot="/app/artifacts/ai-platform/dist/public";
const uiIndex=readFileSync(join(aiUiRoot,"index.html"));
const uiMatch=uiIndex.toString("utf8").match(
  /<script[^>]+src="(\/assets\/index-[a-zA-Z0-9_-]+\.js)"/
);
if(!uiMatch)throw Error("SUPER_ADMIN_UI_MAIN_JS_MISSING");
const uiJs=readFileSync(join(aiUiRoot,uiMatch[1].slice(1)));
const cssMatch=uiIndex.toString("utf8").match(
  /<link[^>]+href="(\/assets\/index-[a-zA-Z0-9_-]+\.css)"/
);
if(!cssMatch)throw Error("SUPER_ADMIN_UI_MAIN_CSS_MISSING");
const uiCss=readFileSync(join(aiUiRoot,cssMatch[1].slice(1)));
if(!uiCss.length)throw Error("SUPER_ADMIN_UI_CSS_EMPTY");
if(!uiJs.includes("Persetujuan Super Admin") ||
   !uiJs.includes("owner-stage-readiness") ||
   !uiJs.includes("owner-approve-and-stage")){
 throw Error("SUPER_ADMIN_PAGE_NOT_IN_ACTUAL_AI_PLATFORM_UI");
}
const uiBuildMeta=readFileSync(join(aiUiRoot,"build-meta.json"));
const uiMeta=JSON.parse(uiBuildMeta.toString("utf8"));
if(uiMeta.commitSha!==expected)throw Error("AI_PLATFORM_UI_NOT_SAME_EXACT_BUILD");
const env={
 ...process.env,
 PORT:"3000",
 SERVE_STATIC_FRONTEND:"true",
 HOSTINGER_FRONTEND:"ai-platform",
 // Required DEV project pin. This is public URL data, not a credential.
 SUPABASE_URL_DEV:"https://xssrfshdrtdfupgqwfdw.supabase.co",
 AI_DEV_BACKGROUND_RUNTIME_ENABLED:"false",
 AI_SCHEDULER_ENABLED:"false",
 AI_INCIDENT_WATCHER_ENABLED:"false",
 AI_PROVIDER_BILLING_MONITOR_ENABLED:"false",
 AI_DISPATCHER_ENABLED:"false",
 OLLAMA_WORKER_RUNTIME_ENABLED:"false",
 CST_DEV_ONEJOB_OWNER_APPROVAL_ENABLED:"false",
 CST_DEV_ONEJOB_BROKER_ENABLED:"false",
 // Deliberately synthetic hostname; no networking permitted by CI Docker.
 SUPABASE_DEV_DATABASE_URL:
   "postgresql://aicore_dev_runtime.xssrfshdrtdfupgqwfdw:synthetic-test-only@" +
   "aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres?sslmode=verify-full",
};
let stopped=false,output="";
let siteProxy;
const server=spawn(process.execPath,["/app/artifacts/api-server/dist/index.mjs"],{
 env,stdio:["ignore","pipe","pipe"]
});
const collect=chunk=>{output=(output+String(chunk)).slice(-16000)};
server.stdout.on("data",collect);
server.stderr.on("data",collect);
server.on("close",()=>{stopped=true});
async function request(path,options={},origin=local){
 const res=await fetch(origin+path,{...options,signal:AbortSignal.timeout(1000)});
 const body=await res.text();
 return {status:res.status,body};
}
const assert=(ok,why)=>{if(!ok)throw Error(why)};
try{
 let ready=false,lastError="";
 for(let n=0;n<50;n++){
  if(stopped)throw Error("CORE_CI_API_EXITED_BEFORE_READINESS");
  try{
   const health=await request("/api/readyz");
   if(health.status===200){ready=true;break}
   lastError="READY_HTTP_"+health.status;
  }catch(e){lastError=e instanceof Error?e.name:"UNREACHABLE"}
  await sleep(250);
 }
 assert(ready,"CORE_CI_API_NOT_READY_"+lastError);
 const get=await request("/api/ai/dev/onejob/owner-stage-readiness");
 assert(get.status===401,"ANONYMOUS_OWNER_GET_NOT_DENIED");
 const post=await request("/api/ai/dev/onejob/owner-approve-and-stage",{
  method:"POST",headers:{"content-type":"application/json"},
  body:JSON.stringify({intent:"APPROVE_ONE_NEW_CST_DEV_MODEL_JOB"})
 });
 assert(post.status===401,"ANONYMOUS_SUPER_ADMIN_POST_NOT_DENIED");
 // Rehearse the exact DEV Nginx split: static AI Platform files at the
 // same origin and /api/ proxied to the compiled Core AI server. No host
 // port is published; Docker --network none allows loopback only.
 siteProxy=createServer(async (req,res)=>{
  try{
   const path=new URL(req.url??"/","http://127.0.0.1").pathname;
   if(path.startsWith("/api/")){
    const parts=[];
    for await(const b of req)parts.push(b);
    const upstream=await fetch(local+path,{
      method:req.method,
      headers:{"content-type":req.headers["content-type"]||"application/json"},
      ...(parts.length?{body:Buffer.concat(parts)}:{}),
      signal:AbortSignal.timeout(2000)
    });
    res.writeHead(upstream.status,{"content-type":
      upstream.headers.get("content-type")||"application/json"});
    res.end(Buffer.from(await upstream.arrayBuffer()));
    return;
   }
   const file=(req.method==="GET"&&(path==="/"||path==="/dev-onejob"))?
     uiIndex: (req.method==="GET"&&path===uiMatch[1])?
     uiJs: (req.method==="GET"&&path===cssMatch[1])?
     uiCss: (req.method==="GET"&&path==="/build-meta.json")?
     uiBuildMeta:null;
   if(file===null){res.writeHead(404);res.end("NOT_FOUND");return}
   res.writeHead(200,{"content-type":path.endsWith(".js")?
     "application/javascript":path.endsWith(".css")?
     "text/css":path.endsWith(".json")?
     "application/json":"text/html"});
   res.end(file);
  }catch{res.writeHead(503);res.end("ISOLATED_PROXY_ERROR")}
 });
 await new Promise((resolve,reject)=>{
  siteProxy.once("error",reject);
  siteProxy.listen(3090,"127.0.0.1",resolve);
 });
 const site="http://127.0.0.1:3090";
 const page=await request("/dev-onejob",{},site);
 assert(page.status===200&&sha256(Buffer.from(page.body))===sha256(uiIndex),
   "SAME_ORIGIN_SUPER_ADMIN_PAGE_NOT_ROUTED");
 const browserJs=await request(uiMatch[1],{},site);
 assert(browserJs.status===200&&sha256(Buffer.from(browserJs.body))===sha256(uiJs),
   "SAME_ORIGIN_SUPER_ADMIN_JS_NOT_ROUTED");
 const css=await request(cssMatch[1],{},site);
 assert(css.status===200&&sha256(Buffer.from(css.body))===sha256(uiCss),
   "SAME_ORIGIN_SUPER_ADMIN_CSS_NOT_ROUTED");
 const meta=await request("/build-meta.json",{},site);
 assert(meta.status===200&&sha256(Buffer.from(meta.body))===sha256(uiBuildMeta),
   "SAME_ORIGIN_SUPER_ADMIN_META_NOT_ROUTED");
 const getViaSite=await request("/api/ai/dev/onejob/owner-stage-readiness",{},site);
 assert(getViaSite.status===401,"SAME_ORIGIN_ANONYMOUS_READINESS_NOT_DENIED");
 const postViaSite=await request("/api/ai/dev/onejob/owner-approve-and-stage",{
   method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({intent:"APPROVE_ONE_NEW_CST_DEV_MODEL_JOB"})
 },site);
 assert(postViaSite.status===401,"SAME_ORIGIN_ANONYMOUS_APPROVAL_NOT_DENIED");
 console.log(JSON.stringify({
  status:"CI_IMAGE_RUNTIME_SMOKE_PASS_NO_AUTHORITY",
  project:"xssrfshdrtdfupgqwfdw",sha:expected,
  apiReadyz:200,anonymousOwnerGet:401,anonymousOwnerPost:401,
  spaDevOnejob:200,buildMetaMatches:true,
  actualAiPlatformUiSha256:sha256(uiJs),uiCssSha256:sha256(uiCss),
  sameOriginFrontendAndApiVerified:true,
  sameOriginAnonymousGet:401,sameOriginAnonymousPost:401,
  ownerSessionAuthenticated:false,ownerApprovalCreated:false,
  dispatchPermitted:false,signerActivated:false,realE2EPass:false,
  releaseDecision:"NO_GO",
 }));
}catch(e){
 const reason=e instanceof Error?e.message:"UNKNOWN";
 console.log(JSON.stringify({
  status:"CI_IMAGE_RUNTIME_SMOKE_FAILED",reason,
  crashSigns:(output.slice(0,550)+"\n"+output.slice(-900))
    .replaceAll(/postgres(?:ql)?:\/\/\S+/g,"REDACTED"),
  releaseDecision:"NO_GO",
 }));
 process.exitCode=1;
}finally{
 if(siteProxy)await new Promise(resolve=>siteProxy.close(resolve));
 if(!stopped)server.kill("SIGTERM");
 await Promise.race([
  new Promise(resolve=>server.once("close",resolve)),
  sleep(1800)
 ]);
 if(!stopped)server.kill("SIGKILL");
}
