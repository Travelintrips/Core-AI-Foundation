import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
const origin='https://dev-ai-task.cstlogistic.co.id';
const resource=origin+'/mcp/android-dev';
const scope='android_dev.control';
const port=Number(process.env.ANDROID_MCP_OAUTH_PORT||18800);
const keyPath=process.env.ANDROID_MCP_OAUTH_KEY_PATH;
const keys=keyPath&&fs.existsSync(keyPath)?fs.readFileSync(keyPath):null;
if(!keys)throw Error('ANDROID_MCP_OAUTH_KEY_PATH must reference operator-provisioned private RSA key');
const privateKey=crypto.createPrivateKey(keys);
if(privateKey.asymmetricKeyType!=='rsa'||privateKey.asymmetricKeyDetails.modulusLength<2048)throw Error('RSA key invalid');
const publicJwk=crypto.createPublicKey(privateKey).export({format:'jwk'});
publicJwk.kid=crypto.createHash('sha256').update(publicJwk.n).digest('hex').slice(0,16);publicJwk.use='sig';publicJwk.alg='RS256';
const pending=new Map();
const signed=(content)=>crypto.createHmac('sha256',keys).update(content).digest('base64url');
const goodRedirect=uri=>{try{const u=new URL(uri);return (((u.protocol==='https:'&&u.hostname==='chatgpt.com'&&(u.pathname==='/connector_platform_oauth_redirect'||/^\/connector\/oauth\/[^/]+$/.test(u.pathname)))||(u.protocol==='http:'&&(u.hostname==='127.0.0.1'||u.hostname==='[::1]')&&/^\/callback\/[A-Za-z0-9_-]{4,128}$/.test(u.pathname)&&u.port!==''))&&!u.username&&!u.password&&!u.hash&&!u.search);}catch{return false;}};
function clientId(uri){return 'androiddev_'+Buffer.from(uri).toString('base64url')+'.'+signed(uri);}
function checkClient(id,uri){if(!goodRedirect(uri)||!id.startsWith('androiddev_'))return false;const last=id.lastIndexOf('.');if(last<11)return false;try{const claim=Buffer.from(id.slice(11,last),'base64url').toString();const signature=signed(claim);const got=id.slice(last+1);return claim===uri&&got.length===signature.length&&crypto.timingSafeEqual(Buffer.from(got),Buffer.from(signature));}catch{return false;}}
function json(res,status,body){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body));}
function html(res,status,body){res.writeHead(status,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'",'referrer-policy':'no-referrer'});res.end(body);}
function body(req){return new Promise((resolve,reject)=>{let s='';req.on('data',b=>{s+=b;if(s.length>8192){reject(Error('too_large'));req.destroy();}});req.on('end',()=>resolve(s));req.on('error',reject);});}
function jwt(sub){const n=Math.floor(Date.now()/1000);const head=Buffer.from(JSON.stringify({alg:'RS256',typ:'at+jwt',kid:publicJwk.kid})).toString('base64url');const payload=Buffer.from(JSON.stringify({iss:origin,aud:resource,sub,scope,iat:n,exp:n+900})).toString('base64url');const data=head+'.'+payload;return data+'.'+crypto.sign('RSA-SHA256',Buffer.from(data),privateKey).toString('base64url');}
function valid(q){return q.get('response_type')==='code'&&q.get('code_challenge_method')==='S256'&&/^[a-zA-Z0-9_-]{43,128}$/.test(q.get('code_challenge')||'')&&checkClient(q.get('client_id')||'',q.get('redirect_uri')||'')&&(q.get('resource')===resource||!q.get('resource'))&&(!q.get('scope')||q.get('scope')===scope);}
function clean(){const n=Date.now();let expiredConsent=0,expiredCodes=0;for(const [k,v] of pending){if(v.exp<n){pending.delete(k);if(v.approved)expiredCodes++;else expiredConsent++;}}if(expiredConsent||expiredCodes)console.info('[oauth-session] expired',JSON.stringify({expiredConsent,expiredCodes}));}
http.createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost'),p=u.pathname;clean();
 if(req.method==='GET'&&p==='/.well-known/oauth-authorization-server')return json(res,200,{issuer:origin,authorization_endpoint:origin+'/oauth/android-dev/authorize',token_endpoint:origin+'/oauth/android-dev/token',registration_endpoint:origin+'/oauth/android-dev/register',jwks_uri:origin+'/oauth/android-dev/jwks',response_types_supported:['code'],grant_types_supported:['authorization_code'],token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],scopes_supported:[scope]});
 if(req.method==='GET'&&p==='/oauth/android-dev/jwks')return json(res,200,{keys:[publicJwk]});
 if(req.method==='POST'&&p==='/oauth/android-dev/register'){const v=JSON.parse(await body(req));if(!Array.isArray(v.redirect_uris)||v.redirect_uris.length!==1||!goodRedirect(v.redirect_uris[0])){const redirects=Array.isArray(v.redirect_uris)?v.redirect_uris.map(x=>{try{const u=new URL(x);return {scheme:u.protocol,host:u.hostname,path:u.pathname}}catch{return {invalid:true}}}):[];console.error('[oauth-register] rejected redirect origins',JSON.stringify(redirects));return json(res,400,{error:'invalid_redirect_uri'});}return json(res,201,{client_id:clientId(v.redirect_uris[0]),redirect_uris:v.redirect_uris,token_endpoint_auth_method:'none'});}
 // Nginx must enforce basic auth on BOTH authorize routes. Loopback access alone is not sufficient for public use.
 if(p==='/oauth/android-dev/authorize'&&req.method==='GET'){
  if(!valid(u.searchParams))return json(res,400,{error:'invalid_request'});
  const csrf=crypto.randomBytes(24).toString('base64url'),nonce=crypto.randomBytes(24).toString('base64url');
  pending.set(nonce,{exp:Date.now()+300000,csrf,query:Object.fromEntries(u.searchParams),approved:false});
  console.info('[oauth-authorize] GET consent issued',JSON.stringify({pendingConsentCount:[...pending.values()].filter(x=>!x.approved).length}));
  res.setHeader('set-cookie','android_oauth_csrf='+csrf+'; HttpOnly; Secure; SameSite=Strict; Path=/oauth/android-dev/authorize; Max-Age=300');
  return html(res,200,'<!doctype html><meta charset="utf-8"><title>Android DEV access approval</title><h2>Izinkan ChatGPT mengakses Android DEV?</h2><p>Hanya perangkat DEV, cakupan android_dev.control. Tindakan sensitif tetap memerlukan izin perangkat.</p><form method="POST" action="/oauth/android-dev/authorize"><input type="hidden" name="nonce" value="'+nonce+'"><input type="hidden" name="csrf" value="'+csrf+'"><button name="decision" value="approve">Setujui akses DEV</button><button name="decision" value="deny">Tolak</button></form>');
 }
 if(p==='/oauth/android-dev/authorize'&&req.method==='POST'){
  const rawBody=await body(req),b=new URLSearchParams(rawBody),submittedNonce=b.get('nonce');
  const v=pending.get(submittedNonce);
  // No raw form, nonce, CSRF, cookies or request identifiers in diagnostics.
  const nonceShape=typeof submittedNonce==='string'&&/^[A-Za-z0-9_-]{32}$/.test(submittedNonce);
  const hasPendingConsent=[...pending.values()].some(item=>!item.approved);
  if(!v)console.warn('[oauth-authorize] POST nonce diagnostics',JSON.stringify({nonceFieldPresent:b.has('nonce'),nonceShapeValid:nonceShape,formFields:[...b.keys()].sort(),pendingConsentPresent:hasPendingConsent,pendingConsentCount:[...pending.values()].filter(x=>!x.approved).length}));
  // Log failure category only: never record nonce, cookie, CSRF, authorization code, or PKCE values.
  const csrfCookiePresent=(req.headers.cookie||'').split(';').some(x=>x.trim().startsWith('android_oauth_csrf='));
  const csrfCookieMatches=!!v&&(req.headers.cookie||'').split(';').map(x=>x.trim()).includes('android_oauth_csrf='+v.csrf);
  const rejection=!v?'missing_or_expired_nonce':v.approved?'already_approved':v.csrf!==b.get('csrf')?'form_csrf_mismatch':!csrfCookiePresent?'missing_csrf_cookie':!csrfCookieMatches?'cookie_csrf_mismatch':null;
  if(rejection){console.warn('[oauth-authorize] POST rejected',JSON.stringify({reason:rejection}));return json(res,403,{error:'invalid_request'});}
  pending.delete(b.get('nonce'));console.info('[oauth-session] consent consumed');const q=new URLSearchParams(v.query),redirect=new URL(q.get('redirect_uri'));
  if(b.get('decision')!=='approve'){redirect.searchParams.set('error','access_denied');}
  else{const code=crypto.randomBytes(32).toString('base64url');pending.set(code,{...v,approved:true,exp:Date.now()+120000});redirect.searchParams.set('code',code);}
  if(q.get('state'))redirect.searchParams.set('state',q.get('state'));console.info('[oauth-authorize] redirect issued',JSON.stringify({decision:b.get('decision')==='approve'?'approve':'deny',codeIssued:b.get('decision')==='approve',redirectHost:redirect.hostname}));res.writeHead(303,{location:redirect.href,'cache-control':'no-store'});return res.end();
 }
 if(p==='/oauth/android-dev/token'&&req.method==='POST'){
  const b=new URLSearchParams(await body(req)),code=b.get('code'),v=pending.get(code);
  if(!v||!v.approved||b.get('grant_type')!=='authorization_code'){console.warn('[oauth-token] invalid grant',JSON.stringify({codePresent:!!code,codeFound:!!v,approved:!!v?.approved}));return json(res,400,{error:'invalid_grant'});}
  pending.delete(code);const q=new URLSearchParams(v.query),verifier=b.get('code_verifier')||'';
  const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
  if(verifier.length<43||verifier.length>128||challenge!==q.get('code_challenge')||b.get('client_id')!==q.get('client_id')||b.get('redirect_uri')!==q.get('redirect_uri'))return json(res,400,{error:'invalid_grant'});
  console.info('[oauth-token] token issued');return json(res,200,{access_token:jwt('android-dev-approved-admin'),token_type:'Bearer',expires_in:900,scope});
 }
 return json(res,404,{error:'not_found'});
 }catch{return json(res,400,{error:'invalid_request'});}
}).listen(port,'127.0.0.1',()=>console.log('DEV OAuth issuer on loopback'));
