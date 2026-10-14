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
  admin('grant','zfold4-dev',uuid);
  const granted=await req(uuid,deviceSecret);
  assert.equal(granted.status,200);
  const body=await granted.json();assert.ok(body.token.length>90);
  assert.equal((await req(other,deviceSecret)).status,403);
  admin('revoke','zfold4-dev');
  assert.equal((await req(uuid,deviceSecret)).status,401);
 }finally{proc.kill();fs.rmSync(dir,{recursive:true,force:true});}
});
