import http from 'node:http';
import {createHash} from 'node:crypto';

const profile=String(process.env.AI_CORE_CHATGPT_BROWSER_PROFILE||'').trim();
const cdpPort=Number(process.env.AI_CORE_CHATGPT_CDP_PORT||'');
if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(profile)||!Number.isInteger(cdpPort)||cdpPort<1024||cdpPort>65535){
  throw new Error('Explicit ChatGPT browser profile and CDP port are required');
}
const expectedConversationId=String(process.env.AI_CORE_CHATGPT_EXPECTED_CONVERSATION_ID||'').trim();
const marker=process.env.AI_CORE_CHATGPT_E2E_MARKER||('DIRECT_OPENCLAW_CHATGPT_E2E_OK_'+Date.now());
const prompt='Uji direct AI Core ke OpenClaw ke ChatGPT tanpa MCP. Balas tepat '+marker;

function getTabs(){
  return new Promise((resolve,reject)=>{
    http.get('http://127.0.0.1:'+cdpPort+'/json',r=>{
      let b='';
      r.on('data',d=>b+=d);
      r.on('end',()=>{try{resolve(JSON.parse(b))}catch(e){reject(e)}});
    }).on('error',reject);
  });
}
function cdp(tab,method,params={}){
  return new Promise((resolve,reject)=>{
    const ws=new WebSocket(tab.webSocketDebuggerUrl);
    const timer=setTimeout(()=>{
      try{ws.close()}catch{}
      reject(new Error('CDP timeout: '+method));
    },120000);
    ws.onopen=()=>ws.send(JSON.stringify({id:1,method,params}));
    ws.onmessage=e=>{
      const m=JSON.parse(e.data);
      if(m.id!==1)return;
      clearTimeout(timer);
      try{ws.close()}catch{}
      if(m.error)reject(new Error(m.error.message||'CDP error'));
      else resolve(m.result);
    };
    ws.onerror=()=>{
      clearTimeout(timer);
      reject(new Error('CDP websocket error'));
    };
  });
}
async function evalValue(tab,expression,awaitPromise=false){
  const r=await cdp(tab,'Runtime.evaluate',{expression,awaitPromise,returnByValue:true});
  return r?.result?.value;
}

const pages=(await getTabs()).filter(t=>t.type==='page'&&t.url?.startsWith('https://chatgpt.com')&&!t.url.includes('/plugins/'));
let tab=null;
for(const candidate of pages){
  const ready=await evalValue(candidate,"(()=>!!document.querySelector('[contenteditable=\\\"true\\\"][role=\\\"textbox\\\"], [contenteditable=\\\"true\\\"][aria-label=\\\"Tanya ChatGPT\\\"], [contenteditable=\\\"true\\\"][aria-label=\\\"Ask ChatGPT\\\"]'))()");
  if(ready){tab=candidate;break;}
}
if(!tab)throw new Error('No authenticated ChatGPT page with writable editor');

const promptJson=JSON.stringify(prompt);
const markerJson=JSON.stringify(marker);
const prepExpr="(()=>{const el=document.querySelector('[contenteditable=\\\"true\\\"][role=\\\"textbox\\\"], [contenteditable=\\\"true\\\"][aria-label=\\\"Tanya ChatGPT\\\"], [contenteditable=\\\"true\\\"][aria-label=\\\"Ask ChatGPT\\\"]');if(!el)return {ok:false,reason:'editor_missing'};el.focus();const sel=window.getSelection();const range=document.createRange();range.selectNodeContents(el);sel.removeAllRanges();sel.addRange(range);document.execCommand('insertText',false,"+promptJson+");el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:"+promptJson+"}));return {ok:(el.innerText||'').includes("+markerJson+")};})()";
const prepared=await evalValue(tab,prepExpr);
if(!prepared?.ok)throw new Error('Failed to populate ChatGPT editor');

const clickExpr="(()=>{const buttons=[...document.querySelectorAll('button')];const b=document.querySelector('button[data-testid=\\\"send-button\\\"]')||buttons.find(x=>['Kirim','Send'].includes((x.getAttribute('aria-label')||x.innerText||'').trim()));if(!b||b.disabled)return false;b.click();return true;})()";
const clicked=await evalValue(tab,clickExpr);
if(!clicked){
  await cdp(tab,'Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
  await cdp(tab,'Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
}

let verify={ok:false,url:tab.url,markerCount:0};
for(let i=0;i<120;i++){
  await new Promise(r=>setTimeout(r,1000));
  try{
    const state=await evalValue(tab,"(()=>{const t=document.body.innerText||'';const count=t.split("+markerJson+").length-1;const busy=!!document.querySelector('button[data-testid=\\\"stop-button\\\"]');return {url:location.href,markerCount:count,busy};})()");
    verify={ok:Number(state?.markerCount)>=2&&state?.busy!==true,url:state?.url||verify.url,markerCount:Number(state?.markerCount||0)};
    if(verify.ok)break;
  }catch{}
}
if(!verify.ok)throw new Error('No confirmed ChatGPT assistant marker');

let finalUrl=verify.url||tab.url;
for(let i=0;i<20&&!String(finalUrl).includes('/c/');i++){
  await new Promise(r=>setTimeout(r,500));
  const liveUrl=await evalValue(tab,'location.href');
  if(typeof liveUrl==='string'&&liveUrl)finalUrl=liveUrl;
}
const conversationId=String(finalUrl).split('/c/')[1]?.split(/[?#]/)[0]||'';
if(!/^[A-Za-z0-9-]{30,64}$/.test(conversationId))throw new Error('Verified reply lacks bounded conversation ID');
if(expectedConversationId&&conversationId!==expectedConversationId)throw new Error('Verified reply conversation binding mismatch');
const verifiedAt=new Date().toISOString();
const evidenceFingerprint=createHash('sha256').update([marker,conversationId,verifiedAt].join('|')).digest('hex');
console.log(JSON.stringify({
  ok:true,
  marker,
  profile,
  cdpPort,
  chatgptSubmitted:true,
  verifiedAssistantReply:true,
  conversationId,
  evidenceFingerprint,
  verifiedAt,
  tabUrl:finalUrl
}));
