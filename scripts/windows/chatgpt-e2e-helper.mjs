import http from 'node:http';
import {createHash} from 'node:crypto';

const marker=process.env.AI_CORE_CHATGPT_E2E_MARKER||('DIRECT_OPENCLAW_CHATGPT_E2E_OK_'+Date.now());
const prompt='Uji direct AI Core ke OpenClaw ke ChatGPT tanpa MCP. Balas tepat '+marker;

function getTabs(){return new Promise((resolve,reject)=>{http.get('http://127.0.0.1:18801/json',r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>{try{resolve(JSON.parse(b))}catch(e){reject(e)}})}).on('error',reject);});}
function cdp(tab,method,params={}){return new Promise((resolve,reject)=>{const ws=new WebSocket(tab.webSocketDebuggerUrl);const timer=setTimeout(()=>{try{ws.close()}catch{};reject(new Error('CDP timeout: '+method));},30000);ws.onopen=()=>ws.send(JSON.stringify({id:1,method,params}));ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id!==1)return;clearTimeout(timer);try{ws.close()}catch{};if(m.error)reject(new Error(m.error.message||'CDP error'));else resolve(m.result);};ws.onerror=()=>{clearTimeout(timer);reject(new Error('CDP websocket error'));};});}
async function evalValue(tab,expression,awaitPromise=false){const r=await cdp(tab,'Runtime.evaluate',{expression,awaitPromise,returnByValue:true});return r?.result?.value;}

const pages=(await getTabs()).filter(t=>t.type==='page'&&t.url?.startsWith('https://chatgpt.com')&&!t.url.includes('/plugins/'));
let tab=null;
for(const candidate of pages){const ready=await evalValue(candidate,"(()=>!!document.querySelector('[contenteditable=\\\"true\\\"][role=\\\"textbox\\\"], [contenteditable=\\\"true\\\"][aria-label=\\\"Tanya ChatGPT\\\"], [contenteditable=\\\"true\\\"][aria-label=\\\"Ask ChatGPT\\\"]'))()");if(ready){tab=candidate;break;}}
if(!tab)throw new Error('No authenticated ChatGPT page with writable editor');

const promptJson=JSON.stringify(prompt);
const markerJson=JSON.stringify(marker);
const prepExpr="(()=>{const el=document.querySelector('[contenteditable=\\\"true\\\"][role=\\\"textbox\\\"], [contenteditable=\\\"true\\\"][aria-label=\\\"Tanya ChatGPT\\\"], [contenteditable=\\\"true\\\"][aria-label=\\\"Ask ChatGPT\\\"]');if(!el)return {ok:false,reason:'editor_missing'};el.focus();const sel=window.getSelection();const range=document.createRange();range.selectNodeContents(el);sel.removeAllRanges();sel.addRange(range);document.execCommand('insertText',false,"+promptJson+");el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:"+promptJson+"}));return {ok:(el.innerText||'').includes("+markerJson+")};})()";
const prepared=await evalValue(tab,prepExpr);
if(!prepared?.ok)throw new Error('Failed to populate ChatGPT editor');

const clickExpr="(()=>{const buttons=[...document.querySelectorAll('button')];const b=document.querySelector('button[data-testid=\\\"send-button\\\"]')||buttons.find(x=>['Kirim','Send'].includes((x.getAttribute('aria-label')||x.innerText||'').trim()));if(!b||b.disabled)return false;b.click();return true;})()";
const clicked=await evalValue(tab,clickExpr);
if(!clicked){await cdp(tab,'Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});await cdp(tab,'Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});}

const verifyExpr="(async()=>{for(let i=0;i<90;i++){await new Promise(r=>setTimeout(r,1000));const assistant=[...document.querySelectorAll('[data-message-author-role=\\\"assistant\\\"]')];const last=assistant.at(-1);const t=last?.innerText||last?.textContent||'';const has=t.includes("+markerJson+");const busy=!!document.querySelector('button[data-testid=\\\"stop-button\\\"]');if(has&&!busy)return {ok:true,url:location.href};}return {ok:false,url:location.href};})()";
const verify=await evalValue(tab,verifyExpr,true);
if(!verify?.ok)throw new Error('No confirmed ChatGPT assistant marker');

const finalUrl=verify.url||tab.url;
const conversationId=String(finalUrl).split('/c/')[1]?.split(/[?#]/)[0]||'';
if(!/^[A-Za-z0-9-]{30,64}$/.test(conversationId))throw new Error('Verified reply lacks bounded conversation ID');
const verifiedAt=new Date().toISOString();
const evidenceFingerprint=createHash('sha256').update([marker,conversationId,verifiedAt].join('|')).digest('hex');
console.log(JSON.stringify({ok:true,marker,profile:'travelincars-dev',chatgptSubmitted:true,verifiedAssistantReply:true,conversationId,evidenceFingerprint,verifiedAt,tabUrl:finalUrl}));