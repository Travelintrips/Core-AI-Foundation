// Dedicated DELL DEV worker preflight. No existing PC2/PC3 identity is reused.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(),'AppData','Local'),'AI-Core');
const id = 'openclaw-dell-chatgpt-wake-dev';
const conversationId = '6ad4e0a7-9964-83ec-81a6-9db5eb8457ae';
const envPath = path.join(root,'dell-chatgpt-wake-dev.env');
const keyPath = path.join(root,'dell-chatgpt-wake-attestation-ed25519.pem');
const publicPath = path.join(root,'dell-chatgpt-wake-attestation-ed25519.pub.pem');
const allowPath = path.join(root,'dell-chatgpt-wake-allowlist.json');
const provision = process.argv.includes('--generate-identity');
function requireSafe(condition,message){if(!condition)throw Error(message);}
fs.mkdirSync(root,{recursive:true});
if(provision){
  requireSafe(!fs.existsSync(keyPath) && !fs.existsSync(publicPath),'Identity already exists; refusing replacement');
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(keyPath,privateKey.export({type:'pkcs8',format:'pem'}),{flag:'wx',mode:0o600});
  fs.writeFileSync(publicPath,publicKey.export({type:'spki',format:'pem'}),{flag:'wx'});
  if(!fs.existsSync(allowPath))fs.writeFileSync(allowPath,JSON.stringify({enabled:true,allowedConversationIds:[conversationId]},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({identityGenerated:true,publicKeyPath:publicPath,privateKeyPath:keyPath,registration:'PENDING'}));
  process.exit(0);
}
requireSafe(fs.existsSync(envPath),'Dedicated DEV credentials not provisioned');
const env=Object.fromEntries(fs.readFileSync(envPath,'utf8').split(/\r?\n/).filter(x=>x.trim()&&!x.trim().startsWith('#')).map(x=>{const i=x.indexOf('=');requireSafe(i>0,'Invalid env line');return [x.slice(0,i),x.slice(i+1).trim().replace(/^["']|["']$/g,'')]}));
requireSafe(env.AI_CORE_OPENCLAW_CLIENT_ID===id,'Worker ID mismatch');
requireSafe(env.AI_CORE_BASE_URL?.replace(/\/$/,'')==='https://dev.cstlogistic.co.id/api','DEV endpoint mismatch');
requireSafe(Boolean(env.AI_CORE_SCOPED_AGENT_TOKEN),'Missing dedicated scoped token');
requireSafe(fs.existsSync(keyPath)&&fs.existsSync(publicPath),'Dedicated identity missing');
const privateKey=crypto.createPrivateKey(fs.readFileSync(keyPath));
const publicKey=crypto.createPublicKey(fs.readFileSync(publicPath));
requireSafe(privateKey.asymmetricKeyType==='ed25519','Wrong key type');
const challenge=crypto.randomBytes(32);
requireSafe(crypto.verify(null,challenge,publicKey,crypto.sign(null,challenge,privateKey)),'Identity signature failed');
const allow=JSON.parse(fs.readFileSync(allowPath,'utf8'));
requireSafe(allow.enabled===true&&JSON.stringify(allow.allowedConversationIds)===JSON.stringify([conversationId]),'Conversation allowlist mismatch');
console.log(JSON.stringify({ok:true,workerId:id,conversationId,identityVerified:true,endpoint:'DEV',registration:'NOT_VERIFIED'}));
