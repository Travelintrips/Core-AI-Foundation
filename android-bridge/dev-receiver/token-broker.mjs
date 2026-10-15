// DEV pairing broker: users approve a short code via a trusted operator.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const directory=process.env.BRIDGE_DEVICE_SPOOL_DIR||'/var/lib/openclaw-android-bridge-dev';
const secret=process.env.BRIDGE_DEVICE_HMAC_SECRET||'';
if(Buffer.byteLength(secret)<32)throw Error('DEV HMAC secret missing');
const devices=path.join(directory,'device-registry.json');
const grants=path.join(directory,'device-job-grants.json');
const requests=path.join(directory,'pairing-requests.json');
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y)};
const load=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return {};throw e;}};
const save=(file,obj)=>{const tmp=file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(obj),{mode:0o600,flag:'wx'});fs.renameSync(tmp,file)};
const respond=(res,status,obj)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(obj));};
const sign=raw=>crypto.createHmac('sha256',secret).update(raw).digest('base64url');
fs.mkdirSync(directory,{recursive:true,mode:0o700});
const broker=http.createServer((req,res)=>{
 if(req.method!=='POST'||!['/v1/android/token','/v1/android/pair/start','/v1/android/pair/status','/v1/android/jobs/next'].includes(req.url))return respond(res,404,{error:'not_found'});
 if(req.headers['content-type']?.split(';')[0]!=='application/json')return respond(res,415,{error:'content_type'});
 let raw='',oversize=false;req.on('data',b=>{raw+=b;if(raw.length>2048){oversize=true;req.destroy();}});
 req.on('end',()=>{
  if(oversize)return;
  try{
   const body=JSON.parse(raw),now=Date.now();
   if(req.url==='/v1/android/pair/start'){
    const pending=load(requests);
    for(const [id,r] of Object.entries(pending))if(r.expiresAt<now||r.status==='redeemed')delete pending[id];
    if(Object.keys(pending).length>=5)return respond(res,429,{error:'pending_limit'});
    const id=crypto.randomUUID(),proof=crypto.randomBytes(32).toString('base64url');
    const code=String(crypto.randomInt(100000,1000000));
    pending[id]={proofHash:hash(proof),codeHash:hash(code),status:'pending',expiresAt:now+5*60*1000,createdAt:new Date().toISOString()};
    save(requests,pending);
    return respond(res,201,{requestId:id,proof,code,expiresAt:pending[id].expiresAt});
   }
   if(req.url==='/v1/android/pair/status'){
    if(!uuid.test(body.requestId||'')||typeof body.proof!=='string')return respond(res,400,{error:'invalid_request'});
    const pending=load(requests),entry=pending[body.requestId];
    if(!entry||entry.expiresAt<now||!equal(entry.proofHash,hash(body.proof)))return respond(res,401,{error:'pair_request_invalid'});
    if(entry.status!=='approved')return respond(res,202,{status:'pending'});
    // Credential is released only to the original request holder, once.
    const registry=load(devices),credential=crypto.randomBytes(32).toString('base64url');
    const deviceId=entry.deviceId;
    if(!deviceId||registry[deviceId]?.active)return respond(res,409,{error:'device_duplicate'});
    registry[deviceId]={hash:hash(credential),active:true,createdAt:new Date().toISOString()};
    entry.status='redeemed';
    save(devices,registry);save(requests,pending);
    return respond(res,200,{status:'paired',deviceId,credential});
   }
   if(req.url==='/v1/android/token'&&!uuid.test(body.jobId||''))return respond(res,400,{error:'invalid_job'});
   const h=req.headers.authorization||'';
   if(!h.startsWith('Bearer ')||h.length>200)return respond(res,401,{error:'invalid_device'});
   const registry=load(devices),key=h.slice(7);
   const device=Object.entries(registry).find(([,v])=>v.active===true&&equal(v.hash,hash(key)));
   if(!device)return respond(res,401,{error:'device_not_paired'});
   if(req.url==='/v1/android/jobs/next'){
    const eligible=Object.entries(load(grants))
      .filter(([id,g])=>uuid.test(id)&&g.active===true&&g.deviceId===device[0]
        &&Number.isSafeInteger(g.expiresAt)&&g.expiresAt>now)
      .sort((a,b)=>b[1].expiresAt-a[1].expiresAt);
    if(!eligible.length)return respond(res,204,{});
    return respond(res,200,{jobId:eligible[0][0],expiresAt:eligible[0][1].expiresAt});
   }
   const grant=load(grants)[body.jobId];
   if(!grant||grant.active!==true||grant.deviceId!==device[0]||!Number.isSafeInteger(grant.expiresAt)||grant.expiresAt<now)
    return respond(res,403,{error:'job_not_assigned'});
   const exp=now+5*60*1000;
   const tokenBody=Buffer.from(JSON.stringify({scope:'android-result:submit',jobId:body.jobId,exp,nonce:crypto.randomBytes(16).toString('hex')})).toString('base64url');
   return respond(res,200,{token:tokenBody+'.'+sign(tokenBody),expiresAt:exp});
  }catch{return respond(res,400,{error:'invalid_request'});}
 });
});
broker.listen(Number(process.env.BRIDGE_DEVICE_TOKEN_PORT||18797),'127.0.0.1',()=>console.log('DEV paired broker ready'));
