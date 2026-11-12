import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html=fs.readFileSync(new URL("../../deploy/ai-coding-standalone-dev/admin_login.html",import.meta.url),"utf8");
const a=html.indexOf("async function loadIssue159(){");
const b=html.indexOf("\nasync function load(){",a);
assert.ok(a>=0 && b>a,"Load Issue159 function missing");
const code=html.slice(a,b);
assert.ok(code.includes("approval-intent/pending"));
assert.ok(code.includes("approval-intent',{claims:c}"));
assert.ok(code.includes("root.contains(b)"));
assert.ok(code.includes("setTimeout("));

function fixture({initial,preflight,after,now=1000000,confirmYes=true,postError=null}){
  const actions=[];
  const statuses={textContent:""};
  let btn;
  const root={
    replaceChildren(){btn=null;},
    append(button){btn=button;},
    contains(button){return btn===button;}
  };
  const pending=[initial,preflight,after].filter(Boolean);
  const timers=[];
  let clock=now;
  const DateMock=class extends Date{static now(){return clock}};
  const api=async (path,opts)=>{
    actions.push({path,opts});
    if(path.endsWith("/pending")){
      if(!pending.length)throw Error("NO_PENDING_FIXTURE");
      return pending.shift();
    }
    assert.equal(path,"/api/gpt02/issue159/approval-intent");
    if(postError)throw Error(postError);
    return {decision:"APPROVE"};
  };
  const context={el:id=>id==="issue159Action"?root:statuses,document:{createElement:()=>({textContent:"",disabled:false})},Date:DateMock,setTimeout:(cb,ms)=>{timers.push({cb,ms});},api,confirm:()=>{actions.push({confirm:true});return confirmYes;}};
  const sandbox=vm.createContext(context);
  vm.runInContext(code,sandbox);
  return {load:()=>vm.runInContext("loadIssue159()",sandbox),get btn(){return btn},actions,statuses,timers,setClock:(v)=>{clock=v}};
}
const claims=(nonce="AAA")=>({taskId:144,commandId:"cmd",attemptId:"attempt",nonce});
const pending=(nonce="AAA",expiry=1200000)=>({pending:true,taskId:144,expiresAt:expiry,claims:claims(nonce)});
const expired=()=>({pending:false,reason:"PENDING_REQUEST_EXPIRED"});

{
 const t=fixture({initial:pending(),preflight:pending(),after:expired()});
 await t.load();
 await t.btn.onclick();
 assert.equal(t.actions.filter(x=>x.path?.endsWith("/pending")).length,3);
 const posts=t.actions.filter(x=>x.path==="/api/gpt02/issue159/approval-intent");
 assert.equal(posts.length,1);
 assert.equal(posts[0].opts.claims.nonce,"AAA");
 assert.ok(t.statuses.textContent.includes("Signing") || t.statuses.textContent.includes("kedaluwarsa"));
}
{
 const t=fixture({initial:pending(),preflight:pending("NEW"),after:pending("NEW")});
 await t.load(); await t.btn.onclick();
 assert.equal(t.actions.filter(x=>x.path==="/api/gpt02/issue159/approval-intent").length,0);
 assert.equal(t.actions.filter(x=>x.confirm).length,0);
 assert.match(t.statuses.textContent,/diperbarui/);
}
{
 const t=fixture({initial:pending(),preflight:expired(),after:expired()});
 await t.load();await t.btn.onclick();
 assert.equal(t.actions.filter(x=>x.path==="/api/gpt02/issue159/approval-intent").length,0);
 assert.match(t.statuses.textContent,/kedaluwarsa/);
}
{
 const t=fixture({initial:pending(),preflight:pending(),after:expired(),postError:'400 {"error":"invalid_claims"}'});
 await t.load();await t.btn.onclick();
 assert.equal(t.actions.filter(x=>x.path==="/api/gpt02/issue159/approval-intent").length,1);
 assert.match(t.statuses.textContent,/Tidak ada persetujuan tersimpan/);
}
{
 const t=fixture({initial:pending("AAA",1005000)});
 await t.load();assert.equal(t.timers.length,1);
 t.setClock(1005001);t.timers[0].cb();
 assert.equal(t.btn.disabled,true);
 assert.match(t.statuses.textContent,/kedaluwarsa/);
}
{
 const t=fixture({initial:pending("AAA",1000000)});
 await t.load();
 assert.equal(t.btn.disabled,true);
 assert.match(t.statuses.textContent,/kedaluwarsa/);
}
console.log("PASS: 6 stale-claim click guards; refreshed request, changed nonce, expired GET, denied POST, expiry timer, already-expired UI");
