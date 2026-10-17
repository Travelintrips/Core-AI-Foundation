import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DurableCallbackReceipts} from './durable-callback-receipts.mjs';
test('duplicate and conflicting callbacks cannot be claimed twice, even after restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dev-callback-idempotency-')),path=join(dir,'receipt.sqlite');
 const event={environment:'DEV',commandId:'cmd',callbackId:'cb',resultId:'result',authenticated:true,correlationVerified:true};
 try{
  const store=new DurableCallbackReceipts(path);
  assert.equal(store.claim(event).accepted,true);
  assert.equal(store.claim(event).reason,'duplicate_callback');
  assert.equal(store.claim({...event,callbackId:'other'}).reason,'conflicting_callback');
  store.close();
  const reopened=new DurableCallbackReceipts(path);
  assert.equal(reopened.claim(event).reason,'duplicate_callback');
  reopened.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('cannot claim without auth, correlation or DEV scope',()=>{
 const store=new DurableCallbackReceipts(':memory:');
 try{
  const input={environment:'DEV',commandId:'cmd',callbackId:'cb',resultId:'res',authenticated:true,correlationVerified:true};
  assert.equal(store.claim({...input,authenticated:false}).accepted,false);
  assert.equal(store.claim({...input,correlationVerified:false}).accepted,false);
  assert.equal(store.claim({...input,environment:'PROD'}).accepted,false);
  assert.equal(store.claim(input).accepted,true);
 }finally{store.close();}
});
