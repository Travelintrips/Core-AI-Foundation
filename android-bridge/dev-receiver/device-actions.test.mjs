import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {normalizeDeviceAction,saveDeviceAction,loadDeviceActions,verifiedDeviceAction} from './device-actions.mjs';
const id='123e4567-e89b-42d3-a456-426614174000', device='zfold4-paired-dev-10';
test('public HTTPS websites need no domain allowlist but refuse local targets and credentials',()=>{
 for(const url of ['http://github.com/', 'https://user:pass@github.com/',
   'https://github.com:444/', 'javascript:alert(1)',
   'https://127.0.0.1/', 'https://localhost/', 'https://host.local/',
   'https://service.internal/', 'https://github.com\\n.evil.com/','https://[::1]/',
   'https://host.test/', 'https://x/'])
   assert.throws(()=>normalizeDeviceAction({kind:'OPEN_URL',target:url}),
     'URL must be rejected: '+JSON.stringify(url));
 for(const url of ['https://hpanel.hostinger.com/','https://console.cloud.google.com/compute/instances',
   'https://example.org/path','https://github.com.evil.com/',
   'https://example.net/anything']) {
  assert.deepEqual(normalizeDeviceAction({kind:'OPEN_URL',target:url}),{kind:'OPEN_URL',target:url});
 }
 assert.throws(()=>normalizeDeviceAction({kind:'OPEN_APP',target:'com.android.settings'}));
 assert.throws(()=>normalizeDeviceAction({kind:'SHELL',target:'id'}));
 assert.deepEqual(normalizeDeviceAction({kind:'DEVICE_STATUS'}),{kind:'DEVICE_STATUS',target:''});
});
test('only active paired device receives one immutable scoped action until expiry',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dev-action-test-'));
 try {
  fs.writeFileSync(path.join(dir,'device-registry.json'),JSON.stringify({[device]:{active:true}}));
  const record=saveDeviceAction(dir,id,device,{kind:'OPEN_URL',target:'https://github.com/'});
  const actions=loadDeviceActions(dir);
  assert.deepEqual(verifiedDeviceAction(actions[id],id,device),record.action);
  assert.equal(verifiedDeviceAction(actions[id],id,'other-device'),null);
  assert.equal(verifiedDeviceAction(actions[id],id,device,Date.now()+3600001),null);
  assert.throws(()=>saveDeviceAction(dir,id,device,{kind:'OPEN_APP',target:'com.openai.chatgpt'}));
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
