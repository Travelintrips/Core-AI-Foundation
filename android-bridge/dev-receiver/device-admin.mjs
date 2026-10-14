// Local VPS administrator utility, never exposed through HTTP.
// Commands: enroll <device-id> ; grant <device-id> <job-uuid> ; revoke <device-id>
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
const dir=process.env.BRIDGE_DEVICE_SPOOL_DIR || '/var/lib/openclaw-android-bridge-dev';
const devices=path.join(dir,'device-registry.json');
const grants=path.join(dir,'device-job-grants.json');
const read=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch(e){if(e.code==='ENOENT')return {};throw e;}};
function save(p,data){const temp=p+'.'+process.pid+'.tmp';fs.writeFileSync(temp,JSON.stringify(data),{mode:0o600,flag:'wx'});fs.renameSync(temp,p);}
const [action,deviceId,jobId]=process.argv.slice(2);
if(!['enroll','grant','revoke'].includes(action)||!/^[-_a-zA-Z0-9]{3,48}$/.test(deviceId||''))throw Error('usage: enroll|grant|revoke <device-id> [job-id]');
fs.mkdirSync(dir,{recursive:true,mode:0o700});
const d=read(devices),g=read(grants);
if(action==='enroll'){
 if(d[deviceId]?.active)throw Error('Device already active; revoke first');
 const credential=crypto.randomBytes(32).toString('base64url');
 d[deviceId]={hash:crypto.createHash('sha256').update(credential).digest('hex'),active:true,createdAt:new Date().toISOString()};
 save(devices,d);
 console.log('DEVICE_ID',deviceId,'ONE_TIME_DEVICE_CREDENTIAL',credential);
}else if(action==='revoke'){
 if(!d[deviceId])throw Error('Unknown device');
 d[deviceId].active=false;
 for(const grant of Object.values(g))if(grant.deviceId===deviceId)grant.active=false;
 save(devices,d);save(grants,g);console.log('REVOKED',deviceId);
}else{
 if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(jobId||''))throw Error('Invalid job UUID');
 if(!d[deviceId]?.active)throw Error('Device not enrolled');
 g[jobId]={deviceId,expiresAt:Date.now()+60*60*1000,active:true};
 save(grants,g);console.log('GRANTED',deviceId,jobId);
}
