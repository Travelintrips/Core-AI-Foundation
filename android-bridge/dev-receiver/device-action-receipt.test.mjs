import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {saveDeviceAction} from './device-actions.mjs';
import {validateActionReceipt,CONFIRMATION,ACTION_REPORT_SOURCE,confirmedSummary} from './device-action-receipt.mjs';

const jobId='afcf1637-e6c9-4c59-9d79-4ccf0fb4f7cb';
const device='zfold4-paired-dev-11';
const secret='test-credential-android-receipt-0000000000000000';
const action={kind:'OPEN_URL',target:'https://github.com/'};
const evidence={protocol:'openclaw-chat-bridge-dev-v1',jobId,
 eventId:'android-result:6f876b16-a15f-4d94-8d1c-b76a6da49775',
 resultSummary:'User confirmed GitHub opened on Z Fold4.',
 source:ACTION_REPORT_SOURCE,userConfirmation:CONFIRMATION,deviceAction:action};
function init(dir) {
 fs.writeFileSync(path.join(dir,'device-registry.json'),JSON.stringify({
   [device]:{active:true,hash:crypto.createHash('sha256').update(secret).digest('hex'),createdAt:new Date().toISOString()}
 }),{mode:0o600});
 fs.writeFileSync(path.join(dir,'device-job-grants.json'),JSON.stringify({
   [jobId]:{active:true,deviceId:device,expiresAt:Date.now()+60*60*1000}
 }),{mode:0o600});
 saveDeviceAction(dir,jobId,device,action);
}
test('confirmation validator requires exact active scoped target',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'android-action-receipt-'));
 try{
  init(dir);
  const claims={jobId,deviceId:device};
  const a=validateActionReceipt(dir,jobId,claims,evidence);
  assert.equal(a.resultSummary,confirmedSummary(action));
  assert.equal(a.evidence,CONFIRMATION);
  assert.match(a.resultSummary,/not independent page verification/);
  assert.throws(()=>validateActionReceipt(dir,jobId,{deviceId:'zfold4-paired-dev-10'},evidence));
  assert.throws(()=>validateActionReceipt(dir,jobId,claims,{...evidence,deviceAction:{kind:'OPEN_URL',target:'https://example.com/'}}));
  assert.throws(()=>validateActionReceipt(dir,jobId,claims,{...evidence,userConfirmation:'NOT_CONFIRMED'}));
  assert.throws(()=>validateActionReceipt(dir,jobId,claims,{...evidence,source:'synthetic-script'}));
  const grants=path.join(dir,'device-job-grants.json');
  fs.writeFileSync(grants,JSON.stringify({[jobId]:{active:false,deviceId:device,expiresAt:Date.now()+60*60*1000}}));
  assert.throws(()=>validateActionReceipt(dir,jobId,claims,evidence));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('paired DEV token -> receipt intake is user confirmed, idempotent, never a forged generic action',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'android-e2e-receipt-'));
 const brokerPort='18975',intakePort='18976';
 const env={...process.env,BRIDGE_DEVICE_SPOOL_DIR:dir,
  BRIDGE_DEVICE_HMAC_SECRET:'test-hmac-only-never-deploy-00000000000000000000'};
 const brokerUrl='http://127.0.0.1:'+brokerPort,intakeUrl='http://127.0.0.1:'+intakePort;
 init(dir);
 const broker=spawn(process.execPath,[fileURLToPath(new URL('./token-broker.mjs',import.meta.url))],{
  env:{...env,BRIDGE_DEVICE_TOKEN_PORT:brokerPort},stdio:'ignore'});
 const intake=spawn(process.execPath,[fileURLToPath(new URL('./server.mjs',import.meta.url))],{
  env:{...env,BRIDGE_DEVICE_PORT:intakePort},stdio:'ignore'});
 const post=(url,body,token)=>fetch(url,{method:'POST',
  headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
  body:JSON.stringify(body)});
 try{
  let ready=false;
  for(let i=0;i<70;i++){try{
   const health=await fetch(intakeUrl+'/health');
   const brokerCheck=await fetch(brokerUrl+'/health');
   if(health.status===200&&brokerCheck.status===404){ready=true;break;}
  }catch{} await delay(60);}
  assert.ok(ready,'DEV broker/intake servers started');
  const tokenRes=await post(brokerUrl+'/v1/android/token',{jobId},secret);
  assert.equal(tokenRes.status,200);
  const {token}=await tokenRes.json();
  const tokenPayload=JSON.parse(Buffer.from(token.split('.')[0],'base64url').toString('utf8'));
  assert.equal(tokenPayload.deviceId,device);
  assert.equal(tokenPayload.jobId,jobId);
  const base=intakeUrl+'/v1/android/result';
  assert.equal((await post(base,{...evidence,deviceAction:{...action,target:'https://example.com/'}},token)).status,403);
  assert.equal((await post(base,{...evidence,userConfirmation:'NO'},token)).status,403);
  assert.equal((await post(base,{...evidence,source:'user-confirmed-chatgpt-android',userConfirmation:undefined,deviceAction:undefined},token)).status,403);
  const first=await post(base,evidence,token);
  assert.equal(first.status,202,await first.text().catch(()=>'')); // response may already be consumed
  const accepted=await first.json();
  assert.equal(accepted.accepted,true);
  assert.equal(accepted.status,'RECEIVED_UNVERIFIED');
  const record=JSON.parse(fs.readFileSync(path.join(dir,accepted.receiptId+'.json'),'utf8'));
  assert.equal(record.deviceId,device);
  assert.deepEqual(record.deviceAction,action);
  assert.equal(record.evidence,CONFIRMATION);
  assert.equal(record.resultSummary,confirmedSummary(action));
  const duplicate=await post(base,evidence,token);
  assert.equal(duplicate.status,200);
  assert.equal((await duplicate.json()).duplicate,true);
  const files=fs.readdirSync(dir).filter(x=>/^[a-f0-9]{64}\.json$/.test(x));
  assert.equal(files.length,1);
 }finally{
  broker.kill();intake.kill();
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
