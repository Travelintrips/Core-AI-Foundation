// DEV-only fail-closed OAuth JWT verifier.
import crypto from 'node:crypto';
const RESOURCE='https://dev-ai-task.cstlogistic.co.id/mcp/android-dev';
const SCOPE='android_dev.control';
const decode=p=>JSON.parse(Buffer.from(p,'base64url').toString('utf8'));
export function resourceMetadata(issuer=process.env.ANDROID_MCP_OAUTH_ISSUER){
 return issuer?{resource:RESOURCE,authorization_servers:[issuer],scopes_supported:[SCOPE]}:null;
}
export async function verifyOAuthToken(header,opts={}){
 const issuer=opts.issuer??process.env.ANDROID_MCP_OAUTH_ISSUER;
 const jwksUrl=opts.jwksUrl??process.env.ANDROID_MCP_OAUTH_JWKS_URL;
 if(!issuer||!jwksUrl||!header?.startsWith('Bearer '))return false;
 const token=header.slice(7),parts=token.split('.');
 if(parts.length!==3||token.length>8192)return false;
 try{
  const h=decode(parts[0]),p=decode(parts[1]),now=Math.floor(Date.now()/1000);
  if(h.alg!=='RS256'||!h.kid||h.typ&&!['JWT','at+jwt'].includes(h.typ))return false;
  if(p.iss!==issuer||!(p.aud===RESOURCE||Array.isArray(p.aud)&&p.aud.includes(RESOURCE)))return false;
  if(!Number.isInteger(p.exp)||p.exp<=now||!Number.isInteger(p.iat)||p.iat>now+60)return false;
  if(p.nbf!==undefined&&(!Number.isInteger(p.nbf)||p.nbf>now+60))return false;
  if(typeof p.scope!=='string'||!p.scope.split(' ').includes(SCOPE))return false;
  const u=new URL(jwksUrl),iss=new URL(issuer);
  if(u.protocol!=='https:'||iss.protocol!=='https:'||u.origin!==iss.origin)return false;
  const r=await (opts.fetch??fetch)(u,{signal:AbortSignal.timeout(2500),headers:{accept:'application/json'}});
  if(!r.ok)return false;
  const body=await r.json(),jwk=body.keys?.find(k=>k.kid===h.kid&&k.kty==='RSA'&&(!k.use||k.use==='sig')&&(!k.alg||k.alg==='RS256'));
  if(!jwk)return false;
  const key=crypto.createPublicKey({key:{kty:'RSA',n:jwk.n,e:jwk.e},format:'jwk'});
  return crypto.verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),key,Buffer.from(parts[2],'base64url'));
 }catch{return false;}
}
