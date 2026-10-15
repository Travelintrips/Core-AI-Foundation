import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {resourceMetadata,verifyOAuthToken} from './android-oauth-auth.mjs';
const ISSUER='https://id.dev-ai-task.cstlogistic.co.id';
const JWKS=ISSUER+'/jwks';
const resource='https://dev-ai-task.cstlogistic.co.id/mcp/android-dev';
const {publicKey,privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const jwk=publicKey.export({format:'jwk'});jwk.kid='testkey';
const fetchMock=async()=>({ok:true,json:async()=>({keys:[jwk]})});
function token(overrides={}){
 const now=Math.floor(Date.now()/1000);
 const head=Buffer.from(JSON.stringify({alg:'RS256',typ:'at+jwt',kid:'testkey'})).toString('base64url');
 const body=Buffer.from(JSON.stringify({iss:ISSUER,aud:resource,scope:'android_dev.control',iat:now,exp:now+600,...overrides})).toString('base64url');
 const signature=crypto.sign('RSA-SHA256',Buffer.from(head+'.'+body),privateKey).toString('base64url');
 return 'Bearer '+head+'.'+body+'.'+signature;
}
test('no issuer or JWKS fails closed',async()=>assert.equal(await verifyOAuthToken(token(),{issuer:'',jwksUrl:''}),false));
test('metadata advertises Android DEV resource',()=>assert.equal(resourceMetadata(ISSUER).resource,resource));
test('valid scoped token verifies',async()=>assert.equal(await verifyOAuthToken(token(),{issuer:ISSUER,jwksUrl:JWKS,fetch:fetchMock}),true));
for(const [name,claims] of [['wrong audience',{aud:'https://aicore.cstlogistic.co.id'}],['wrong scope',{scope:'ai_core.command'}],['expired',{exp:1}],['wrong issuer',{iss:'https://attacker.example'}]]){
 test(name+' is rejected',async()=>assert.equal(await verifyOAuthToken(token(claims),{issuer:ISSUER,jwksUrl:JWKS,fetch:fetchMock}),false));
}
test('bad signature rejected',async()=>assert.equal(await verifyOAuthToken(token().slice(0,-3)+'AAA',{issuer:ISSUER,jwksUrl:JWKS,fetch:fetchMock}),false));
