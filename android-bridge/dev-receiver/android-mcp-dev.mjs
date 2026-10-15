// DEV ONLY. Stateless MCP HTTP transport on loopback; requires independent bearer token.
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {saveDeviceAction, normalizeDeviceAction} from './device-actions.mjs';
import {siteForKey} from './phone-site-catalog.mjs';
const ORIGIN='https://dev-ai-task.cstlogistic.co.id';
const DEVICE_DIR='/var/lib/openclaw-android-bridge-dev';
const DEVICE_FILE=DEVICE_DIR+'/device-registry.json';
const SECRET_FILE='/etc/ai-task-android-mcp-dev/token';
const CONTAINER='ai-task-dev-pr49-hostnet';
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const MAX_BODY=8192;
const PHONE_MCP_SITES=Object.freeze({
 open_github_on_zfold4_dev:'github',
 open_hostinger_on_zfold4_dev:'hostinger',
 open_gcp_on_zfold4_dev:'gcp',
 open_hostinger_vps_on_zfold4_dev:'hostinger-vps',
 open_gcp_compute_on_zfold4_dev:'gcp-compute'
});
const TOOLS=[
 {name:'create_android_dev_job',description:'Create one DEV-only Android Z Fold4 test job for the most recently paired active device. No PROD.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'open_github_on_zfold4_dev',description:'Create a DEV-only OPEN_URL GitHub job assigned to the paired Z Fold4, never PC/DELL; automatically opens Chrome in phone foreground after an authorized DEV job; no second approval dialog.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'open_hostinger_on_zfold4_dev',description:'Open Hostinger hPanel in Chrome on paired Z Fold4 automatically opens on paired phone in foreground; no login/changes automated, never PC/PROD.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'open_gcp_on_zfold4_dev',description:'Open Google Cloud Console in Chrome on paired Z Fold4 automatically opens on paired phone in foreground; no IAM or VM writes, never PC/PROD.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'open_hostinger_vps_on_zfold4_dev',description:'Guide phone user to Hostinger VPS page in Chrome using a predefined URL; read-only navigation intent, no mutation.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'open_gcp_compute_on_zfold4_dev',description:'Guide phone user to GCP Compute Engine VM instances page in Chrome using a predefined URL; read-only navigation intent, no mutation.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'open_url_on_zfold4_dev',description:'Create paired Z Fold4 DEV job to open an arbitrary public HTTPS page. Navigates only; does not click, log in, delete or change accounts.',inputSchema:{type:'object',properties:{url:{type:'string',minLength:12,maxLength:600}},required:['url'],additionalProperties:false}},
 {name:'get_android_dev_job',description:'Read authoritative DEV status, callback, verification, and ACK count for one Android job UUID.',inputSchema:{type:'object',properties:{jobId:{type:'string'}},required:['jobId'],additionalProperties:false}},
 {name:'get_android_dev_job_events',description:'Read bounded DEV lifecycle event types for one Android job UUID.',inputSchema:{type:'object',properties:{jobId:{type:'string'}},required:['jobId'],additionalProperties:false}}
];
function respond(res,status,body,extra={}) {
 res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...extra});
 res.end(JSON.stringify(body));
}
function error(id,code,message){return {jsonrpc:'2.0',id,error:{code,message}};}
function result(id,value){return {jsonrpc:'2.0',id,result:value};}
function checkAuth(header){
 const expected=fs.readFileSync(SECRET_FILE,'utf8').trim();
 const supplied=typeof header==='string'&&header.startsWith('Bearer ')?header.slice(7):'';
 const a=Buffer.from(expected),b=Buffer.from(supplied);
 return a.length>=48&&a.length===b.length&&crypto.timingSafeEqual(a,b);
}
function latestDevice(){
 const reg=JSON.parse(fs.readFileSync(DEVICE_FILE,'utf8'));
 const candidates=Object.entries(reg).filter(([id,v])=>/^zfold4-paired-dev-[0-9]{2}$/.test(id)&&v?.active===true&&
   typeof v.createdAt==='string'&&Number.isFinite(Date.parse(v.createdAt)));
 if(!candidates.length)throw Error('No active paired Z Fold4 in DEV');
 candidates.sort((a,b)=>Date.parse(b[1].createdAt)-Date.parse(a[1].createdAt));
 return candidates[0][0];
}
function assertDev(raw){
 if(!raw.includes('NODE_ENV=development')||!raw.includes('SUPABASE_DATABASE_URL_DEV=')||
    raw.includes('\nSUPABASE_PROD_DATABASE_URL=')||raw.includes('\nSUPABASE_DATABASE_URL='))
  throw Error('DEV isolation verification failed');
}
function bridgeToken(){
 const raw=execFileSync('/usr/bin/docker',['inspect',CONTAINER,'--format','{{range .Config.Env}}{{println .}}{{end}}'],
   {encoding:'utf8',timeout:9000,maxBuffer:262144});
 assertDev(raw);
 const tokens=raw.split('\n').filter(s=>s.startsWith('AI_TASK_BRIDGE_TOKEN='));
 if(tokens.length!==1||tokens[0].length<54)throw Error('DEV bridge unavailable');
 return tokens[0].slice('AI_TASK_BRIDGE_TOKEN='.length);
}
function query(sql,id){
 // All input is a validated UUID, not user-supplied SQL. The script runs only inside isolated DEV container.
 const script=`const {Pool}=require('/app/artifacts/api-server/node_modules/pg');
 if(process.env.NODE_ENV!=='development'||!process.env.SUPABASE_DATABASE_URL_DEV||
 process.env.SUPABASE_DATABASE_URL||process.env.SUPABASE_PROD_DATABASE_URL)process.exit(12);
 (async()=>{const p=new Pool({connectionString:process.env.SUPABASE_DATABASE_URL_DEV,
 ssl:{rejectUnauthorized:false},max:1,connectionTimeoutMillis:7000});
 try{const r=await p.query(${JSON.stringify(sql)},[${JSON.stringify(id)}]); console.log(JSON.stringify(r.rows));}
 finally{await p.end();}})().catch(()=>process.exit(13));`;
 const stdout=execFileSync('/usr/bin/docker',['exec',CONTAINER,'node','-e',script],
   {encoding:'utf8',timeout:16000,maxBuffer:65536});
 return JSON.parse(stdout);
}
const JOB_SQL=`SELECT j.id,j.status,j.source_session_id,
 (j.callback_received_at IS NOT NULL) AS callback_received,
 (j.result_verified_at IS NOT NULL) AS result_verified,
 (SELECT count(*)::int FROM ai_task_bridge.job_events e WHERE e.job_id=j.id AND e.kind='CALLBACK_ACK') AS ack_count
 FROM ai_task_bridge.jobs j WHERE j.id=$1 AND j.source='OPENCLAW'
 AND j.source_session_id LIKE 'android-dev:%' LIMIT 1`;
const EVENTS_SQL=`SELECT kind,received_at FROM ai_task_bridge.job_events WHERE job_id=$1
 AND EXISTS(SELECT 1 FROM ai_task_bridge.jobs j WHERE j.id=$1 AND j.source='OPENCLAW'
 AND j.source_session_id LIKE 'android-dev:%') ORDER BY received_at ASC LIMIT 30`;
async function callTool(name,args){
 if(!TOOLS.some(x=>x.name===name))throw Error('Unknown DEV tool');
 if(!args||typeof args!=='object'||Array.isArray(args))throw Error('Invalid arguments');
 if(name==='create_android_dev_job'||name==='open_url_on_zfold4_dev'||Object.hasOwn(PHONE_MCP_SITES,name)){
  const siteKey=PHONE_MCP_SITES[name];
  const site=siteKey?siteForKey(siteKey):null;
  if(name==='open_url_on_zfold4_dev') {
   if(Object.keys(args).length!==1)throw Error('URL only');
  } else if(Object.keys(args).length)throw Error('Unexpected arguments');
  const customAction=name==='open_url_on_zfold4_dev'?normalizeDeviceAction({kind:'OPEN_URL',target:args.url}):null;
  const device=latestDevice(),key='android-mcp-dev:'+crypto.randomUUID();
  const response=await fetch('http://127.0.0.1:18183/api/bridge/jobs',{
   method:'POST',headers:{'authorization':'Bearer '+bridgeToken(),'content-type':'application/json'},
   body:JSON.stringify({source:'OPENCLAW',externalId:key,idempotencyKey:key,
    title:site?site.title:customAction?'Z Fold4 DEV OPEN_URL Custom':'Z Fold4 DEV MCP E2E check',
    sessionId:'android-dev:'+device}),
   signal:AbortSignal.timeout(12000)});
  const body=await response.json();
  if(response.status!==201||!body.accepted||!UUID.test(body.task?.id||''))throw Error('DEV creation rejected');
  if(site||customAction){
   // The DEV dispatcher will not grant a phone URL job until its scoped action exists.
   try {
    saveDeviceAction(DEVICE_DIR,body.task.id,device,customAction||{kind:'OPEN_URL',target:site.url});
   } catch {
    // Do not conceal a successfully created job: returning its identity avoids
    // the user generating duplicates when action registration failed.
    return {jobId:body.task.id,status:'ACTION_REGISTRATION_FAILED',
      deviceId:device,environment:'DEV',action:'OPEN_URL',url:customAction?.target||site.url,
      error:'action_registration_failed',retryCreatesDuplicate:true};
   }
  }
  return {jobId:body.task.id,status:body.task.status,deviceId:device,environment:'DEV',
    ...((site||customAction)?{action:'OPEN_URL',url:customAction?.target||site.url,site:site?.label||'Public HTTPS'}:{})};
 }
 if(Object.keys(args).length!==1||!UUID.test(args.jobId||''))throw Error('Valid jobId UUID required');
 const rows=query(name==='get_android_dev_job'?JOB_SQL:EVENTS_SQL,args.jobId);
 if(name==='get_android_dev_job')return rows[0]||{jobId:args.jobId,found:false};
 return {jobId:args.jobId,events:rows};
}
async function handle(req){
 const id=req.id??null;
 if(req.jsonrpc!=='2.0'||typeof req.method!=='string')return error(id,-32600,'Invalid JSON-RPC');
 if(req.method==='initialize')return result(id,{protocolVersion:'2025-06-18',
  capabilities:{tools:{listChanged:false}},serverInfo:{name:'ai-task-android-dev-mcp',version:'0.1.0'}});
 if(req.method==='notifications/initialized')return null;
 if(req.method==='ping')return result(id,{});
 if(req.method==='tools/list')return result(id,{tools:TOOLS});
 if(req.method==='tools/call'){
  try{const name=req.params?.name,args=req.params?.arguments??{};
   const value=await callTool(name,args);
   return result(id,{content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value,isError:false});
  }catch(e){return result(id,{content:[{type:'text',text:'DEV tool failed; check MCP server logs'}],isError:true});}
 }
 return error(id,-32601,'Method not found');
}
http.createServer((req,res)=>{
 if(req.url!=='/mcp/android-dev')return respond(res,404,{error:'not_found'});
 if(req.method!=='POST')return respond(res,405,{error:'method_not_allowed'}, {'allow':'POST'});
 if(!checkAuth(req.headers.authorization))return respond(res,401,{error:'unauthorized'},{'www-authenticate':'Bearer realm="ai-task-android-dev"'});
 if(req.headers['content-type']?.split(';')[0]!=='application/json')return respond(res,415,{error:'content_type'});
 let body='',tooLarge=false;
 req.on('data',data=>{body+=data;if(body.length>MAX_BODY){tooLarge=true;req.destroy();}});
 req.on('end',async()=>{
  if(tooLarge)return;
  try{const message=JSON.parse(body),out=await handle(message);
   if(out===null){res.writeHead(202,{'cache-control':'no-store'});res.end();return;}
   respond(res,200,out,{'mcp-protocol-version':'2025-06-18'});
  }catch{respond(res,400,error(null,-32700,'Parse error'));}
 });
}).listen(18799,'127.0.0.1',()=>console.log('AI Task Android MCP DEV ready on loopback'));
