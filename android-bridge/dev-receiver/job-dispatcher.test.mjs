import test from 'node:test';
import assert from 'node:assert/strict';
import {eligible,planGrants} from './job-dispatcher.mjs';
import {DEV_PHONE_SITES} from './phone-site-catalog.mjs';
const a='123e4567-e89b-42d3-a456-426614174000';
const b='123e4567-e89b-42d3-a456-426614174001';
const device='zfold4-paired-dev-03';
const assigned=(id,source_session_id,status='QUEUED')=>({id,source:'OPENCLAW',source_session_id,status});
test('explicit DEV-only assignment: deny unpaired, untagged and completed',()=>{
 const registry={[device]:{active:true},other:{active:false}};
 const rows=[assigned(a,'android-dev:'+device),assigned(b,null),assigned(b,'android-dev:other'),assigned(b,'android-dev:'+device,'COMPLETED'),assigned(b,'android-prod:'+device)];
 assert.deepEqual(eligible(rows,registry),[{id:a,deviceId:device}]);
});
test('grant renews only queued explicitly routed jobs; no cross-device takeover',()=>{
 const registry={[device]:{active:true},another:{active:true}};
 const rows=[assigned(a,'android-dev:'+device),assigned(b,'android-dev:another')];
 const current={ [b]:{deviceId:device,expiresAt:1,active:false} };
 const created=planGrants(rows,registry,current,1000);
 assert.equal(created[a].deviceId,device);
 assert.equal(created[a].expiresAt,3601000);
 assert.deepEqual(created[b],current[b]);
 assert.deepEqual(planGrants(rows,registry,created,2000),created);
 assert.equal(planGrants(rows,registry,created,3101000)[a].expiresAt,6701000);
});

test('Z Fold4 GitHub job is never granted without matching phone-only OPEN_URL intent',()=>{
 const now=1000;
 const registry={[device]:{active:true},other:{active:true}};
 const row={...assigned(a,'android-dev:'+device),title:'Z Fold4 DEV OPEN_URL GitHub'};
 assert.deepEqual(eligible([row],registry,now),[]);
 assert.deepEqual(planGrants([row],registry,{},now),{});
 const allowed={jobId:a,deviceId:device,expiresAt:now+60*60*1000,
   action:{kind:'OPEN_URL',target:'https://github.com/'}};
 const valid={[a]:allowed};
 assert.deepEqual(eligible([row],registry,now,valid),[{id:a,deviceId:device}]);
 assert.equal(planGrants([row],registry,{},now,valid)[a].deviceId,device);
 assert.deepEqual(eligible([row],registry,now,{[a]:{...allowed,deviceId:'other'}}),[]);
 assert.deepEqual(eligible([row],registry,now,{[a]:{...allowed,action:{kind:'OPEN_URL',target:'https://github.com.evil.test/'}}}),[]);
 assert.deepEqual(eligible([row],registry,now+60*60*1000,valid),[]);
});

test('Hostinger/GCP dashboard and read-only section routing requires exact scoped phone action',()=>{
 const now=1000,registry={[device]:{active:true},another:{active:true}};
 for(const site of Object.values(DEV_PHONE_SITES)){
  const row={...assigned(a,'android-dev:'+device),title:site.title};
  assert.deepEqual(eligible([row],registry,now),[]);
  assert.deepEqual(eligible([row],registry,now,{[a]:{
   jobId:a,deviceId:device,expiresAt:now+5000,
   action:{kind:'OPEN_URL',target:site.url==='https://github.com/'?'https://github.com.evil.test/':'https://github.com/'}
  }}),[]);
  const valid={ [a]:{jobId:a,deviceId:device,expiresAt:now+5000,
    action:{kind:'OPEN_URL',target:site.url}} };
  assert.deepEqual(eligible([row],registry,now,valid),[{id:a,deviceId:device}]);
  assert.equal(planGrants([row],registry,{},now,valid)[a].deviceId,device);
  assert.deepEqual(eligible([row],registry,now,{[a]:{...valid[a],deviceId:'another'}}),[]);
 }
 const unknown={...assigned(b,'android-dev:'+device),title:'Z Fold4 DEV OPEN_URL Arbitrary'};
 assert.deepEqual(eligible([unknown],registry,now),[]);
 const custom={...assigned(b,'android-dev:'+device),title:'Z Fold4 DEV OPEN_URL Custom'};
 assert.deepEqual(eligible([custom],registry,now),[]);
 const validCustom={[b]:{jobId:b,deviceId:device,expiresAt:now+5000,action:{kind:'OPEN_URL',target:'https://example.org/other'}}};
 assert.deepEqual(eligible([custom],registry,now,validCustom),[{id:b,deviceId:device}]);
 assert.deepEqual(eligible([custom],registry,now,{[b]:{...validCustom[b],deviceId:'another'}}),[]);
});
