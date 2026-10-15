import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyOAuthToken} from './android-oauth-auth.mjs';
const work=mkdtempSync(join(tmpdir(),'android-oauth-test-'));
const privateKey=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
const key=join(work,'key.pem');writeFileSync(key,privateKey,{mode:0o600});
const port=18867,root='http://127.0.0.1:'+port;
const proc=spawn(process.execPath,[fileURLToPath(new URL('./android-oauth-server.mjs',import.meta.url))],{env:{...process.env,ANDROID_MCP_OAUTH_KEY_PATH:key,ANDROID_MCP_OAUTH_PORT:String(port)},stdio:'ignore'});
async function ready(){for(let i=0;i<60;i++){try{const r=await fetch(root+'/.well-known/oauth-authorization-server');if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,75));}throw Error('OAuth server did not start');}
test('OAuth DEV PKCE code flow requires explicit admin approval',async()=>{
 try{
  await ready();
  const meta=await(await fetch(root+'/.well-known/oauth-authorization-server')).json();assert.equal(meta.issuer,'https://dev-ai-task.cstlogistic.co.id');
  const redirect='https://chatgpt.com/connector_platform_oauth_redirect';
  const register=await fetch(root+'/oauth/android-dev/register',{method:'POST',body:JSON.stringify({redirect_uris:[redirect]})});
  assert.equal(register.status,201);const client=(await register.json()).client_id;
  const invalid=await fetch(root+'/oauth/android-dev/register',{method:'POST',body:JSON.stringify({redirect_uris:['https://attacker.example/callback']})});
  assert.equal(invalid.status,400);
  const verifier=crypto.randomBytes(40).toString('base64url'),challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
  const q=new URLSearchParams({response_type:'code',client_id:client,redirect_uri:redirect,code_challenge_method:'S256',code_challenge:challenge,state:'client-state',scope:'android_dev.control'});
  const auth=await fetch(root+'/oauth/android-dev/authorize?'+q);assert.equal(auth.status,200);
  const body=await auth.text(),nonce=body.match(/name="nonce" value="([^"]+)"/)?.[1],csrf=body.match(/name="csrf" value="([^"]+)"/)?.[1];
  assert.ok(nonce&&csrf);
  const bad=await fetch(root+'/oauth/android-dev/authorize',{method:'POST',body:new URLSearchParams({nonce,csrf,decision:'approve'}),redirect:'manual'});assert.equal(bad.status,403);
  const approved=await fetch(root+'/oauth/android-dev/authorize',{method:'POST',headers:{cookie:'android_oauth_csrf='+csrf},body:new URLSearchParams({nonce,csrf,decision:'approve'}),redirect:'manual'});
  assert.equal(approved.status,302);const cb=new URL(approved.headers.get('location'));assert.equal(cb.searchParams.get('state'),'client-state');const code=cb.searchParams.get('code');assert.ok(code);
  const wrong=await fetch(root+'/oauth/android-dev/token',{method:'POST',body:new URLSearchParams({code,grant_type:'authorization_code',client_id:client,redirect_uri:redirect,code_verifier:'wrong'})});
  assert.equal(wrong.status,400);
  const replay=await fetch(root+'/oauth/android-dev/token',{method:'POST',body:new URLSearchParams({code,grant_type:'authorization_code',client_id:client,redirect_uri:redirect,code_verifier:verifier})});
  assert.equal(replay.status,400);
  const second=await fetch(root+'/oauth/android-dev/authorize?'+q);const html=await second.text();const n=html.match(/name="nonce" value="([^"]+)"/)[1],c=html.match(/name="csrf" value="([^"]+)"/)[1];
  const ok=await fetch(root+'/oauth/android-dev/authorize',{method:'POST',headers:{cookie:'android_oauth_csrf='+c},body:new URLSearchParams({nonce:n,csrf:c,decision:'approve'}),redirect:'manual'});
  const tokenCode=new URL(ok.headers.get('location')).searchParams.get('code');
  const token=await fetch(root+'/oauth/android-dev/token',{method:'POST',body:new URLSearchParams({code:tokenCode,grant_type:'authorization_code',client_id:client,redirect_uri:redirect,code_verifier:verifier})});
  assert.equal(token.status,200);const data=await token.json();assert.equal(data.token_type,'Bearer');assert.ok(data.access_token.length>300);
  const verified=await verifyOAuthToken('Bearer '+data.access_token,{issuer:'https://dev-ai-task.cstlogistic.co.id',jwksUrl:'https://dev-ai-task.cstlogistic.co.id/oauth/android-dev/jwks',fetch:()=>fetch(root+'/oauth/android-dev/jwks')});
  assert.equal(verified,true);
 }finally{proc.kill();rmSync(work,{recursive:true,force:true});}
});