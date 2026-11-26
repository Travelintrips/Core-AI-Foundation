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
assert.ok(code.includes("MIN_CHAIN_WINDOW_MS=120000"));

function fixture({initial,preflight,after,now=1000000,confirmYes=true,confirmAdvanceMs=0,postError=null,postResponse=null}){
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
    return postResponse || {decision:"APPROVE"};
  };
  const context={el:id=>id==="issue159Action"?root:statuses,document:{createElement:()=>({textContent:"",disabled:false})},Date:DateMock,setTimeout:(cb,ms)=>{timers.push({cb,ms});},api,confirm:()=>{actions.push({confirm:true});clock+=confirmAdvanceMs;return confirmYes;}};
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
 const t=fixture({initial:pending()});
 await t.load();assert.equal(t.timers.length,1);
 assert.equal(t.timers[0].ms,80000);
 t.setClock(1080001);t.timers[0].cb();
 assert.equal(t.btn.disabled,true);
 assert.match(t.statuses.textContent,/kurang dari 2 menit/);
}
{
 const t=fixture({initial:pending("AAA",1000000)});
 await t.load();
 assert.equal(t.btn.disabled,true);
 assert.match(t.statuses.textContent,/kedaluwarsa/);
}
{
 const changed={...pending(),claims:{...claims(),"commandId":"different-command"}};
 const t=fixture({initial:pending(),preflight:changed,after:changed});
 await t.load();await t.btn.onclick();
 assert.equal(t.actions.filter(x=>x.path==="/api/gpt02/issue159/approval-intent").length,0);
 assert.equal(t.actions.filter(x=>x.confirm).length,0);
 assert.match(t.statuses.textContent,/diperbarui/);
}
{
 const t=fixture({initial:pending(),preflight:pending(),after:expired(),
  postResponse:{autoChainCompleted:true,releaseDecision:"NO_GO",dispatchPermitted:false}});
 await t.load();await t.btn.onclick();
 assert.match(t.statuses.textContent,/Final ACK operasional belum terverifikasi/);
 assert.match(t.statuses.textContent,/Signing, authorization, dan dispatch tetap NO-GO/);
 assert.doesNotMatch(t.statuses.textContent,/full-chain DEV selesai/);
 assert.equal(t.actions.filter(x=>x.path==="/api/gpt02/issue159/approval-intent").length,1);
}
{
 const t=fixture({initial:pending(),preflight:pending(),after:expired(),
  postResponse:{autoChainCompleted:false,autoChainError:"ISSUER_READER_NOT_READY"}});
 await t.load();await t.btn.onclick();
 assert.match(t.statuses.textContent,/auto-chain berhenti aman: ISSUER_READER_NOT_READY/);
 assert.match(t.statuses.textContent,/Final ACK belum terverifikasi/);
}
{
 const t=fixture({initial:pending(),preflight:pending(),after:expired(),
  postError:'503 {"error":"issue159_approved_packet_recovery_required","intentRecorded":true,"approvalCanBeReplayed":false}'});
 await t.load();await t.btn.onclick();
 assert.match(t.statuses.textContent,/Persetujuan sudah tercatat/);
 assert.match(t.statuses.textContent,/Jangan setujui ulang/);
 assert.equal(t.actions.filter(x=>x.path==="/api/gpt02/issue159/approval-intent").length,1);
}
{
 const t=fixture({initial:pending("AAA",1119000)});
 await t.load();
 assert.equal(t.btn.disabled,true);
 assert.match(t.statuses.textContent,/kurang dari 2 menit/);
 await t.btn.onclick();
 assert.equal(t.actions.filter(x=>x.path==="/api/gpt02/issue159/approval-intent").length,0);
}
{
 // Even if a disabled-button timer has not fired yet, the click guard
 // rejects the precommit window instead of sending a one-use approval.
 const t=fixture({initial:pending(),preflight:pending(),after:pending()});
 await t.load();t.setClock(1080000);await t.btn.onclick();
 assert.equal(t.actions.filter(x=>x.confirm).length,0);
 assert.equal(t.actions.filter(x=>x.path==="/api/gpt02/issue159/approval-intent").length,0);
 assert.match(t.statuses.textContent,/kurang dari 2 menit/);
}
{
 // The time window may close while the owner is reading the native confirm.
 // A second check after confirming must still block the irreversible POST.
 const t=fixture({initial:pending(),preflight:pending(),after:pending(),confirmAdvanceMs:81000});
 await t.load();await t.btn.onclick();
 assert.equal(t.actions.filter(x=>x.confirm).length,1);
 assert.equal(t.actions.filter(x=>x.path==="/api/gpt02/issue159/approval-intent").length,0);
 assert.match(t.statuses.textContent,/kurang dari 2 menit setelah konfirmasi/);
}
{
 // Native confirm can be dismissed after the chain deadline. The finally
 // handler must never reactivate the already-expired approval button.
 const t=fixture({initial:pending(),preflight:pending(),
  confirmYes:false,confirmAdvanceMs:81000});
 await t.load();await t.btn.onclick();
 assert.equal(t.actions.filter(x=>x.confirm).length,1);
 assert.equal(t.actions.filter(x=>x.path==="/api/gpt02/issue159/approval-intent").length,0);
 assert.equal(t.btn.disabled,true);
 assert.match(t.statuses.textContent,/kurang dari 2 menit/);
}
console.log("PASS: 14 guarded clicks; strict 120s precommit window, cancel race, consent binding and truthful Final ACK");

