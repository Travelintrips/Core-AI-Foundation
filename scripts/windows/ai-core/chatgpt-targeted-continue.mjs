import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const [file] = process.argv.slice(2);
if (!file) throw Error('A JSON job file is required');
const job=JSON.parse(fs.readFileSync(file,'utf8'));
if (job.mode!=='chatgpt_continue' ||
    !/^https:\/\/chatgpt\.com\/c\/[a-zA-Z0-9-]{20,64}$/.test(job.conversationUrl) ||
    !/^[A-Za-z0-9_-]{8,90}$/.test(job.jobId) ||
    typeof job.message!=='string' || job.message.length<8 || job.message.length>5000) {
  throw Error('Invalid or unbound ChatGPT continuation job');
}
const marker='ACK_'+job.jobId;
const payload='[AI CORE VERIFIED JOB '+job.jobId+']\n'+job.message+
  '\n\nUntuk mengonfirmasi penerimaan, sertakan kode '+marker+' dalam respons Anda.';
const node=path.join(process.env.LOCALAPPDATA,'OpenClaw','deps','portable-node','node.exe');
const entry=path.join(process.env.LOCALAPPDATA,'OpenClaw','deps','portable-node','node_modules','openclaw','dist','index.js');
const receiptDir=path.join(process.env.LOCALAPPDATA,'AI-Core','chatgpt-job-receipts');
fs.mkdirSync(receiptDir,{recursive:true});
const receiptPath=path.join(receiptDir,job.jobId+'.json');
const fingerprint=crypto.createHash('sha256').update(job.conversationUrl+'\n'+job.message).digest('hex');
if(fs.existsSync(receiptPath)){
 const receipt=JSON.parse(fs.readFileSync(receiptPath,'utf8'));
 if(receipt.fingerprint!==fingerprint)throw Error('Duplicate job ID with different payload');
 if(receipt.verifiedAssistantReply===true){console.log(JSON.stringify(receipt));process.exit(0)}
}
function browser(...args) {
 const p=spawnSync(node,[entry,'browser',...args],{encoding:'utf8',windowsHide:true,timeout:90000,maxBuffer:4*1024*1024});
 if(p.error || p.status!==0)throw Error('OpenClaw browser '+args[0]+' failed: '+String(p.stderr||p.error?.message||p.stdout).slice(0,260));
 return String(p.stdout||'');
}
function findRef(s,type,label){
 const found=s.match(new RegExp('- '+type+' "'+label+'" \\[ref=(e\\d+)\\]'));
 if(!found)throw Error('Browser control missing: '+label);
 return found[1];
}
const tabs=JSON.parse(browser('tabs','--json')).tabs||[];
const tab=tabs.find(t=>t.url===job.conversationUrl)||tabs.find(t=>t.url?.startsWith('https://chatgpt.com/'));
if(!tab)throw Error('Authenticated ChatGPT browser tab unavailable');
const target=tab.targetId;
if(tab.url!==job.conversationUrl){
 browser('navigate',job.conversationUrl,'--target-id',target);
 const changed=JSON.parse(browser('tabs','--json')).tabs||[];
 if(!changed.some(t=>t.targetId===target&&t.url===job.conversationUrl))
   throw Error('Browser did not navigate to exact conversation ID');
}
function pageText(){
 return browser('snapshot','--target-id',target,'--compact','--limit','700');
}
let screen=browser('snapshot','--target-id',target,'--compact','--interactive','--limit','350');
if(!pageText().includes('[AI CORE VERIFIED JOB '+job.jobId+']')){
 const ref=findRef(screen,'textbox','Ask ChatGPT');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pc-bound-chat-'));
 try {
  const fields=path.join(directory,'fields.json');
  fs.writeFileSync(fields,JSON.stringify([{ref,value:payload}]));
  browser('fill','--target-id',target,'--fields-file',fields);
  screen=browser('snapshot','--target-id',target,'--compact','--interactive','--limit','350');
  const send=findRef(screen,'button','Send');
  browser('click',send,'--target-id',target);
 } finally {fs.rmSync(directory,{recursive:true,force:true})}
}
for(let i=0;i<8;i++){
 const plain=pageText();
 const lastUser=plain.lastIndexOf('You said:');
 const lastAssistant=plain.lastIndexOf('ChatGPT said:');
 const assistantSection=lastAssistant>lastUser ? plain.slice(lastAssistant) : '';
 const confirmed=assistantSection.includes(marker) && plain.includes('Response complete');
 if(confirmed){
  const receipt={jobId:job.jobId,conversationUrl:job.conversationUrl,fingerprint,
   verifiedAssistantReply:true,verifiedAt:new Date().toISOString(),marker};
  const temp=receiptPath+'.tmp';
  fs.writeFileSync(temp,JSON.stringify(receipt),{mode:0o600});
  fs.renameSync(temp,receiptPath);
  console.log(JSON.stringify(receipt));
  process.exit(0);
 }
}
throw Error('No verifiable completion in the correct ChatGPT conversation; job remains unconfirmed');


[executed on device: DESKTOP-CPS76BH (99eaf032-53f5-49fb-813e-c0e20373bfae)]