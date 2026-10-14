// DEV-only loopback broker for device-scoped job tokens. No service token on Android.
// Enrollment and job assignment occur via a privileged local CLI, not via public requests.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const directory=process.env.BRIDGE_DEVICE_SPOOL_DIR || '/var/lib/openclaw-android-bridge-dev';
const secret=process.env.BRIDGE_DEVICE_HMAC_SECRET || '';
if(Buffer.byteLength(secret)<32) throw Error('DEV HMAC secret missing');
const devicesFile=path.join(directory,'device-registry.json');
const grantsFile=path.join(directory,'device-job-grants.json');
const isUuid=x=>typeof x==='string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const match=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y);};
const load=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return {};throw e;}};
const reply=(res,status,obj)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(obj));};
const sign=raw=>crypto.createHmac('sha256',secret).update(raw).digest('base64url');
fs.mkdirSync(directory,{recursive:true,mode:0o700});

const server=http.createServer((req,res)=>{
 if(req.method!=='POST'||req.url!=='/v1/android/token')return reply(res,404,{error:'not_found'});
 if(req.headers['content-type']?.split(';')[0]!=='application/json')return reply(res,415,{error:'content_type'});
 let raw='';
 req.on('data',chunk=>{raw+=chunk;if(raw.length>2048)req.destroy();});
 req.on('end',()=>{
  try{
   const body=JSON.parse(raw);
   if(!isUuid(body.jobId))return reply(res,400,{error:'invalid_job'});
   const auth=req.headers.authorization||'';
   if(!auth.startsWith('Bearer ')||auth.length>200)return reply(res,401,{error:'invalid_device'});
   const credential=auth.slice(7);
   const records=load(devicesFile);
   const paired=Object.entries(records).find(([,device])=>device.active===true && match(device.hash,hash(credential)));
   if(!paired)return reply(res,401,{error:'device_not_paired'});
   const grant=load(grantsFile)[body.jobId];
   if(!grant||grant.active!==true||grant.deviceId!==paired[0]||!Number.isSafeInteger(grant.expiresAt)||grant.expiresAt<Date.now())
    return reply(res,403,{error:'job_not_assigned'});
   const exp=Date.now()+5*60*1000;
   const payload={scope:'android-result:submit',jobId:body.jobId,exp,nonce:crypto.randomBytes(16).toString('hex')};
   const rawToken=Buffer.from(JSON.stringify(payload)).toString('base64url');
   return reply(res,200,{token:rawToken+'.'+sign(rawToken),expiresAt:exp});
  }catch{return reply(res,400,{error:'invalid_request'});}
 });
});
server.listen(Number(process.env.BRIDGE_DEVICE_TOKEN_PORT||18797),'127.0.0.1',()=>console.log('DEV device token broker on loopback'));
