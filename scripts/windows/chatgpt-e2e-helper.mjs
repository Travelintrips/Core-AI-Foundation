import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const node=path.join(process.env.LOCALAPPDATA,'OpenClaw','deps','portable-node','node.exe');
const entry=path.join(process.env.LOCALAPPDATA,'OpenClaw','deps','portable-node','node_modules','openclaw-known-good-20260909','dist','index.js');
const profile=process.env.AI_CORE_CHATGPT_BROWSER_PROFILE||'travelincars-dev';
const marker=process.env.AI_CORE_CHATGPT_E2E_MARKER||'DIRECT_OPENCLAW_CHATGPT_E2E_OK_20261021';
const prompt='Uji direct AI Core ke OpenClaw ke ChatGPT tanpa MCP. Balas tepat '+marker;

function browser(...args){
  const p=spawnSync(node,[entry,'browser',args[0],'--browser-profile',profile,...args.slice(1)],{
    encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:4*1024*1024
  });
  if(p.error||p.status!==0)throw Error('browser '+args[0]+' failed: '+String(p.stderr||p.error?.message||p.stdout).slice(0,500));
  return String(p.stdout||'');
}
function refAny(s,type,labels){
  for(const label of labels){
    const esc=label.replace(/[.*+?^$(){}|[\]\\]/g,'\\$&');
    const m=s.match(new RegExp('\\- '+type+' "'+esc+'" \\[ref=(e\\d+)\\]'));
    if(m)return m[1];
  }
  throw Error('Missing '+type+': '+labels.join(' | '));
}
function getTabs(){
  return new Promise((resolve,reject)=>{
    http.get('http://127.0.0.1:18801/json',r=>{
      let b='';
      r.on('data',d=>b+=d);
      r.on('end',()=>{try{resolve(JSON.parse(b))}catch(e){reject(e)}});
    }).on('error',reject);
  });
}

const tabs=JSON.parse(browser('tabs','--json')).tabs||[];
const tab=tabs.find(t=>t.url?.startsWith('https://chatgpt.com')&&!t.url.includes('/plugins/'));
if(!tab)throw Error('No authenticated ChatGPT tab');
const target=tab.suggestedTargetId||tab.tabId||tab.targetId;
let screen=browser('snapshot','--target-id',target,'--compact','--limit','240');
const chatMatch=screen.match(/\- button "Chat" \[ref=(e\d+)\]([^\n]*)/);
if(chatMatch&&!chatMatch[2].includes('[pressed]')){
  browser('click',chatMatch[1],'--target-id',target);
  screen=browser('snapshot','--target-id',target,'--compact','--limit','240');
}
const textbox=refAny(screen,'textbox',['Tanya ChatGPT','Ask ChatGPT','Bekerja dengan ChatGPT']);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'direct-oc-chatgpt-'));
try{
  const fields=path.join(tmp,'form.json');
  fs.writeFileSync(fields,JSON.stringify([{ref:textbox,value:prompt}]));
  browser('fill','--target-id',target,'--fields-file',fields);
  screen=browser('snapshot','--target-id',target,'--compact','--limit','260');
  const send=refAny(screen,'button',['Kirim','Send']);
  browser('click',send,'--target-id',target);
}finally{
  fs.rmSync(tmp,{recursive:true,force:true});
}

const liveTabs=await getTabs();
const live=liveTabs.find(t=>t.type==='page'&&t.url?.startsWith('https://chatgpt.com')&&!t.url.includes('/plugins/'));
if(!live)throw Error('ChatGPT tab disappeared');
const verify=await new Promise((resolve,reject)=>{
  const ws=new WebSocket(live.webSocketDebuggerUrl);
  const timer=setTimeout(()=>{try{ws.close()}catch{};reject(new Error('verify timeout'));},90000);
  ws.onopen=()=>ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{
    awaitPromise:true,returnByValue:true,
    expression:'(async()=>{for(let i=0;i<75;i++){await new Promise(r=>setTimeout(r,1000));const t=document.body.innerText||"";const has=t.includes("'+marker+'");const busy=!!document.querySelector("button[data-testid=stop-button]");if(has&&!busy)return {ok:true,url:location.href};}return {ok:false,url:location.href};})()'
  }}));
  ws.onmessage=e=>{
    const m=JSON.parse(e.data);
    if(m.id!==1)return;
    clearTimeout(timer);
    try{ws.close()}catch{}
    resolve(m.result?.result?.value);
  };
  ws.onerror=()=>{clearTimeout(timer);reject(new Error('verify ws error'));};
});
if(!verify?.ok)throw Error('No confirmed ChatGPT assistant marker');

await new Promise(r=>setTimeout(r,1200));
const finalTabs=await getTabs();
const finalTab=finalTabs.find(t=>t.targetId===tab.targetId)||finalTabs.find(t=>t.type==='page'&&t.url?.startsWith('https://chatgpt.com/c/'));
const finalUrl=finalTab?.url||verify.url||tab.url;
const conversationId=String(finalUrl).split('/c/')[1]?.split(/[?#]/)[0]||'';
if(!/^[A-Za-z0-9-]{30,64}$/.test(conversationId))throw Error('Verified reply lacks bounded conversation ID');
const verifiedAt=new Date().toISOString();
const evidenceFingerprint=createHash('sha256').update([marker,conversationId,verifiedAt].join('|')).digest('hex');
console.log(JSON.stringify({
  ok:true,
  marker,
  profile,
  chatgptSubmitted:true,
  verifiedAssistantReply:true,
  conversationId,
  evidenceFingerprint,
  verifiedAt,
  tabUrl:finalUrl
}));
