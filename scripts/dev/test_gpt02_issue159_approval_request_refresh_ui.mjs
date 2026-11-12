import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const file = new URL("../../deploy/ai-coding-standalone-dev/admin_login.html",import.meta.url);
const html=fs.readFileSync(file,"utf8");
const start=html.indexOf("async function loadIssue159(){");
const end=html.indexOf("\nasync function load(){",start);
assert.ok(start>=0 && end>start);
const source=html.slice(start,end);
assert.ok(source.includes("'/api/gpt02/issue159/approval-intent/refresh'"));
assert.ok(source.includes("d.reason==='PENDING_REQUEST_EXPIRED'"));

const expired={pending:false,reason:"PENDING_REQUEST_EXPIRED",releaseDecision:"NO_GO"};
const freshClaims={nonce:"fixture-nonce",commandId:"fixture-command",attemptId:"fixture-attempt"};
const fresh={
 pending:true,taskId:148,expiresAt:Date.now()+240000,claims:freshClaims,
 signingPermitted:false,authorizationGranted:false,dispatchPermitted:false,
 releaseDecision:"NO_GO",
};
const refreshed={
 environment:"DEV",taskId:148,expiresAt:fresh.expiresAt,
 requestRefreshed:true,signingPermitted:false,authorizationGranted:false,
 dispatchPermitted:false,releaseDecision:"NO_GO",
};

function simulate(mode="success"){
 const calls=[];
 let button=null;
 const status={textContent:""};
 const root={
  replaceChildren(){button=null;},
  append(b){button=b;},
  contains(b){return button===b;}
 };
 const data=mode==="success"?[expired,fresh]:[expired];
 const context={
  api:async(path,body)=>{
   calls.push({path,body});
   if(path.endsWith("/pending"))return data.shift()||expired;
   if(path.endsWith("/refresh")){
    if(mode==="expired")throw Error('409 {"error":"ISSUE159_PREPARATION_NOT_FRESH_ENOUGH"}');
    if(mode==="approved")throw Error('409 {"error":"ISSUE159_APPROVAL_ALREADY_RECORDED"}');
    return refreshed;
   }
   throw Error("UNEXPECTED_API_CALL:"+path);
  },
  el:id=>id==="issue159Action"?root:status,
  document:{createElement:tag=>{
   assert.equal(tag,"button");
   return {disabled:false,textContent:"",onclick:null};
  }},
  Date,
  setTimeout:()=>{},
  confirm:()=>{throw Error("REFRESH_MUST_NOT_ASK_FOR_APPROVAL")},
 };
 const vmContext=vm.createContext(context);
 const load=async()=>vm.runInContext(source+"\nloadIssue159()",vmContext);
 return {load,click:async()=>{assert.ok(button);return button.onclick();},
         get button(){return button;},calls,status};
}

{
 const f=simulate("success");
 await f.load();
 assert.match(f.button.textContent,/Perbarui permintaan/);
 await f.click();
 assert.equal(f.calls.filter(x=>x.path.endsWith("/refresh")).length,1);
 assert.deepEqual(JSON.parse(JSON.stringify(f.calls.filter(x=>x.path.endsWith("/refresh"))[0].body)),{});
 assert.ok(f.calls.filter(x=>x.path.endsWith("/pending")).length===2);
 assert.match(f.button.textContent,/Setujui task ini satu kali/);
 assert.match(f.status.textContent,/Permintaan baru tersedia/);
 assert.equal(f.calls.filter(x=>x.path.endsWith("/approval-intent")).length,0);
}
{
 const f=simulate("expired");
 await f.load();await f.click();
 assert.match(f.status.textContent,/Preparation task sudah kedaluwarsa/);
 assert.equal(f.calls.filter(x=>x.path.endsWith("/approval-intent")).length,0);
}
{
 const f=simulate("approved");
 await f.load();await f.click();
 assert.match(f.status.textContent,/sudah pernah disetujui/);
 assert.equal(f.calls.filter(x=>x.path.endsWith("/approval-intent")).length,0);
}
console.log("PASS: manual on-demand refresh shows fresh approval, denies expired/consumed preparation, NEVER auto-approves");
