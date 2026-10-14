import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
const uuid='e2b234b3-28bf-4f02-bb1a-9ff9126b84fc';
const other='e9203104-0938-4f58-9fea-0873b77a53d8';
test('DEV pairing grants, deny by default, and revoke',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-token-test-'));
 const env={...process.env,BRIDGE_DEVICE_SPOOL_DIR:dir,BRIDGE_DEVICE_TOKEN_PORT:'18897',BRIDGE_DEVICE_HMAC_SECRET:'test-key-only-never-use-in-deploy-0000000000'};
 const admin=(...args)=>{const p=spawnSync(process.execPath,[fileURLToPath(new URL('./device-admin.mjs',import.meta.url)),...args],{env,encoding:'utf8'});assert.equal(p.status,0,p.stderr);return p.stdout};
 const enroll=admin('enroll','zfold4-dev');
 const deviceSecret=enroll.match(/ONE_TIME_DEVICE_CREDENTIAL ([^\s]+)/)?.[1];
 assert.ok(deviceSecret&&deviceSecret.length>=40);
 const proc=spawn(process.execPath,[fileURLToPath(new URL('./token-broker.mjs',import.meta.url))],{env,stdio:'ignore'});
 try {
  let ready=false;
  for(let i=0;i<50;i++){try{await fetch('http://127.0.0.1:18897/health');ready=true;break;}catch{await delay(60)}}
  assert.ok(ready);
  const req=(jobId,key)=>fetch('http://127.0.0.1:18897/v1/android/token',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+key},body:JSON.stringify({jobId})});
  assert.equal((await req(uuid,'incorrect-device-credential')).status,401);
  assert.equal((await req(uuid,deviceSecret)).status,403);
  const next=(key)=>fetch('http://127.0.0.1:18897/v1/android/jobs/next',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+key},body:'{}'});
  assert.equal((await next('unknown-device')).status,401);
  assert.equal((await next(deviceSecret)).status,204);
  admin('grant','zfold4-dev',uuid);
  const assigned=await next(deviceSecret);
  assert.equal(assigned.status,200);
  assert.equal((await assigned.json()).jobId,uuid);
  const granted=await req(uuid,deviceSecret);
  assert.equal(granted.status,200);
  const body=await granted.json();assert.ok(body.token.length>90);
  assert.equal((await req(other,deviceSecret)).status,403);
  admin('revoke','zfold4-dev');
  assert.equal((await req(uuid,deviceSecret)).status,401);
 }finally{proc.kill();fs.rmSync(dir,{recursive:true,force:true});}
});

test('one-tap pairing requires explicit approval and is single use',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-one-tap-test-'));
 const port='18898';
 const env={...process.env,BRIDGE_DEVICE_SPOOL_DIR:dir,BRIDGE_DEVICE_TOKEN_PORT:port,BRIDGE_DEVICE_HMAC_SECRET:'test-key-only-never-use-in-deploy-0000000000'};
 const proc=spawn(process.execPath,[fileURLToPath(new URL('./token-broker.mjs',import.meta.url))],{env,stdio:'ignore'});
 const api=(route,value)=>fetch('http://127.0.0.1:'+port+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
 try{
  for(let i=0;i<50;i++){try{await fetch('http://127.0.0.1:'+port+'/health');break}catch{await delay(60)}}
  const start=await api('/v1/android/pair/start',{});
  assert.equal(start.status,201);
  const item=await start.json();
  assert.match(item.code,/^\d{6}$/);
  const pending=await api('/v1/android/pair/status',{requestId:item.requestId,proof:item.proof});
  assert.equal(pending.status,202);
  const wrong=await api('/v1/android/pair/status',{requestId:item.requestId,proof:'wrong'});
  assert.equal(wrong.status,401);
  const approval=spawnSync(process.execPath,[fileURLToPath(new URL('./approve-pairing.mjs',import.meta.url)),item.code,'physical-fold4-dev'],{env,encoding:'utf8'});
  assert.equal(approval.status,0,approval.stderr);
  const paired=await api('/v1/android/pair/status',{requestId:item.requestId,proof:item.proof});
  assert.equal(paired.status,200);
  const data=await paired.json();
  assert.equal(data.status,'paired'); assert.ok(data.credential.length>=40);
  const reuse=await api('/v1/android/pair/status',{requestId:item.requestId,proof:item.proof});
  assert.equal(reuse.status,202);
  const unauthorizedToken=await fetch('http://127.0.0.1:'+port+'/v1/android/token',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+data.credential},body:JSON.stringify({jobId:uuid})});
  assert.equal(unauthorizedToken.status,403);
 }finally{proc.kill();fs.rmSync(dir,{recursive:true,force:true});}
});
