// Trusted local admin only. Confirm short code displayed by the physical Android app.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
const dir=process.env.BRIDGE_DEVICE_SPOOL_DIR||'/var/lib/openclaw-android-bridge-dev';
const file=path.join(dir,'pairing-requests.json');
const [code,deviceId]=process.argv.slice(2);
if(!/^\d{6}$/.test(code||'')||!/^[-_a-zA-Z0-9]{3,48}$/.test(deviceId||''))throw Error('Usage: approve-pairing.mjs <six digit code> <trusted device-id>');
const data=JSON.parse(fs.readFileSync(file,'utf8'));
const digest=crypto.createHash('sha256').update(code).digest('hex');
const entries=Object.entries(data).filter(([,x])=>x.status==='pending'&&x.expiresAt>Date.now()&&x.codeHash===digest);
if(entries.length!==1)throw Error('No unique valid pending approval');
const [requestId,entry]=entries[0];
entry.status='approved';entry.deviceId=deviceId;delete entry.codeHash;
// The broker runs as www-data. Atomic replacement by a root operator must
// retain its existing owner; otherwise the next status poll fails with HTTP 400.
const owner=fs.statSync(file);
const tmp=file+'.'+process.pid+'.tmp';
try {
 fs.writeFileSync(tmp,JSON.stringify(data),{flag:'wx',mode:0o600});
 const written=fs.statSync(tmp);
 if(written.uid!==owner.uid||written.gid!==owner.gid)fs.chownSync(tmp,owner.uid,owner.gid);
 fs.renameSync(tmp,file);
}finally{try{fs.unlinkSync(tmp)}catch(e){if(e.code!=='ENOENT')throw e}}
console.log('APPROVED',requestId,'DEVICE',deviceId);
