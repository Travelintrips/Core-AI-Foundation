'use strict';
// DEV DELL fail-closed cryptographic verifier. Reads public key ONLY;
// never creates signatures, opens a browser, claims work, or makes requests.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const DIGEST=/^[0-9a-f]{64}$/;
const BINDING=/^[0-9a-f]{64}$/;
const SIG=/^[A-Za-z0-9+/]{86}==$/;
const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const WORKER='openclaw-dell-chatgpt-wake-dev';
const KEY_ID='openclaw-dell-chatgpt-wake-dev-ed25519-v1';
const PUBLIC_FILE='dell-chatgpt-wake-attestation-ed25519.pub.pem';
function payloadV2(att){
 return [
  'dev-chatgpt-assistant-attestation/v2',
  'keyId='+att.keyId,
  'workerId='+att.workerId,
  'conversationId='+att.conversationId,
  'eventId='+att.eventId,
  'challenge='+att.challenge,
  'assistantMessageId='+att.assistantMessageId,
  'assistantResponseHash='+att.assistantResponseHash,
  'observedAt='+att.observedAt,
  'bindingFingerprint='+att.bindingFingerprint,
  'browserProfile='+att.browserProfile,
 ].join('\n');
}
function verifyDellBoundSignature(att,text,root,expected={}){
 try{
  if(!att||typeof att!=='object'||Array.isArray(att)||typeof root!=='string'||!root.trim())
   return false;
  if(att.version!==2||att.algorithm!=='Ed25519'||att.workerId!==WORKER||att.keyId!==KEY_ID)
   return false;
  if(!UUID.test(att.conversationId)||!DIGEST.test(att.eventId)||
     !DIGEST.test(att.challenge)||!UUID.test(att.assistantMessageId)||
     !DIGEST.test(att.assistantResponseHash)||!BINDING.test(att.bindingFingerprint)||
     typeof att.browserProfile!=='string'||! /^[A-Za-z0-9_-]{1,64}$/.test(att.browserProfile))
   return false;
  if(!ISO.test(att.observedAt)||!Number.isFinite(Date.parse(att.observedAt))||
     Date.parse(att.observedAt)>Date.now()+5000)return false;
  if(typeof text!=='string'||!text||text.length>4000||att.assistantResponseText!==text||
     crypto.createHash('sha256').update(text,'utf8').digest('hex')!==att.assistantResponseHash)
   return false;
  if(!SIG.test(att.signature))return false;
  if(expected.conversationId!==att.conversationId||expected.eventId!==att.eventId||
     expected.challenge!==att.challenge||expected.bindingFingerprint!==att.bindingFingerprint||
     expected.browserProfile!==att.browserProfile)return false;
  const pubFile=path.join(root,PUBLIC_FILE);
  const stat=fs.statSync(pubFile);
  if(!stat.isFile()||stat.size>500||stat.size<75)return false;
  const pub=crypto.createPublicKey(fs.readFileSync(pubFile));
  if(pub.asymmetricKeyType!=='ed25519')return false;
  const signature=Buffer.from(att.signature,'base64');
  if(signature.length!==64||signature.toString('base64')!==att.signature)return false;
  return crypto.verify(null,Buffer.from(payloadV2(att),'utf8'),pub,signature);
 }catch{return false}
}
module.exports={verifyDellBoundSignature,payloadV2};
