import assert from 'node:assert/strict';
import { createIssuerReaderServer } from '../../dist/issuer-reader-runtime/gpt02-issuer-reader-runtime.mjs';
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
let healthCalls=0, readCalls=0, allowHealth=true;
const healthy = () => ({readOnlySessionVerified:true,nativeRoleAuthenticated:true,tlsVerified:true,operationalTrustedReaderRuntime:true,signingPermitted:false,authorizationGranted:false,dispatchPermitted:false,releaseDecision:'NO_GO'});
const reader = {
  health:async()=>{healthCalls++;await sleep(160);return allowHealth?healthy():{...healthy(),readOnlySessionVerified:false};},
  read:async()=>{readCalls++;return {persistedTrustedReadProven:false,signingPermitted:false,authorizationGranted:false,dispatchPermitted:false,releaseDecision:'NO_GO'};}
};
const server=createIssuerReaderServer({reader});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port;
try {
 const rs=await Promise.all([fetch(url+'/health'),fetch(url+'/health')]);
 assert.deepEqual(rs.map(x=>x.status),[200,200]);assert.equal(healthCalls,1);
 const start=performance.now();
 const [h,e]=await Promise.all([fetch(url+'/health'),fetch(url+'/issuer-evidence',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({claims:{},observedAt:Date.now()})})]);
 assert.equal(h.status,200);assert.equal(e.status,409);assert.equal(healthCalls,1);assert.equal(readCalls,1);
 assert(performance.now()-start<130,'cached health should not block read evidence');
 console.log('PASS: concurrent health dedup, cached health + rejected evidence, no proof cache');
 await sleep(5100);
 allowHealth=false;
 assert.equal((await fetch(url+'/health')).status,503);
 assert.equal((await fetch(url+'/health')).status,503);
 assert.equal(healthCalls,3);
 console.log('PASS: failed health not cached, repeated probe returns 503');
}finally{await new Promise(resolve=>server.close(resolve));}
