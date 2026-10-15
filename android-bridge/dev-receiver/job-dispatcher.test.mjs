import test from 'node:test';
import assert from 'node:assert/strict';
import {eligible,planGrants} from './job-dispatcher.mjs';
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
