// DEV-only intake. Bind to loopback; require TLS at the reverse proxy.
// No AI Core service secrets are exposed to an Android client.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {loadDeviceActions} from './device-actions.mjs';
import {validateActionReceipt, ACTION_REPORT_SOURCE, AUTO_REPORT_SOURCE} from './device-action-receipt.mjs';

const secret = process.env.BRIDGE_DEVICE_HMAC_SECRET || '';
if (Buffer.byteLength(secret) < 32) throw Error('BRIDGE_DEVICE_HMAC_SECRET must be 32+ bytes');
const spoolDir = process.env.BRIDGE_DEVICE_SPOOL_DIR || '/var/lib/openclaw-android-bridge-dev';
const port = Number(process.env.BRIDGE_DEVICE_PORT || '18798');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const equal = (x,y) => { const a=Buffer.from(x),b=Buffer.from(y);return a.length===b.length && crypto.timingSafeEqual(a,b); };
const sign = raw => crypto.createHmac('sha256',secret).update(raw).digest('base64url');
function verify(rawToken, jobId) {
  if (typeof rawToken !== 'string' || rawToken.length > 1500) return null;
  const parts = rawToken.split('.');
  if (parts.length !== 2 || !equal(sign(parts[0]),parts[1])) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (payload.scope !== 'android-result:submit' || payload.jobId !== jobId ||
        !Number.isInteger(payload.exp) || payload.exp < Date.now() || payload.exp > Date.now()+15*60*1000 ||
        typeof payload.nonce !== 'string' || payload.nonce.length <= 10) return null;
    return payload;
  } catch { return null; }
}
function reply(res,code,data) {
  res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});
  res.end(JSON.stringify(data));
}
fs.mkdirSync(spoolDir,{recursive:true,mode:0o700});
const server = http.createServer((req,res)=>{
  if (req.method === 'GET' && req.url === '/health') return reply(res,200,{healthy:true,env:'dev'});
  if (req.method !== 'POST' || req.url !== '/v1/android/result') return reply(res,404,{error:'not_found'});
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') return reply(res,415,{error:'content_type'});
  const authorization=req.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) return reply(res,401,{error:'unauthorized'});
  let body='';
  req.on('data',chunk=>{ body += chunk; if(body.length > 12000) req.destroy(); });
  req.on('end',()=>{
    try {
      const msg=JSON.parse(body);
      if (!uuid.test(msg.jobId||'') || !/^android-result:[\da-f-]{36}$/i.test(msg.eventId||'') ||
          typeof msg.resultSummary !== 'string' || !msg.resultSummary.trim() ||
          msg.resultSummary.length > 2000 || msg.protocol !== 'openclaw-chat-bridge-dev-v1')
        return reply(res,400,{error:'invalid_result'});
      const claims=verify(authorization.slice(7),msg.jobId);
      if (!claims) return reply(res,401,{error:'invalid_or_expired_job_token'});
      // For a phone action, the intake requires a paired-device-scoped token,
      // a currently valid grant, the exact allowlisted action and a user
      // confirmation from that device. Never auto-claim a generic text result
      // as proof that a browser page opened.
      let attestation=null;
      const storedAction=loadDeviceActions(spoolDir)[msg.jobId];
      if (storedAction || msg.deviceAction || msg.source === ACTION_REPORT_SOURCE || msg.source === AUTO_REPORT_SOURCE) {
        try {attestation=validateActionReceipt(spoolDir,msg.jobId,claims,msg);}
        catch {return reply(res,403,{error:'action_confirmation_not_authorized'});}
      }
      const resultSummary=attestation?.resultSummary ?? msg.resultSummary;
      // Durable no-overwrite idempotent inbox for a trusted server-side bridge consumer.
      const receiptId=crypto.createHash('sha256').update(msg.jobId+'|'+msg.eventId).digest('hex');
      const destination=path.join(spoolDir,receiptId+'.json');
      const resultDigest=crypto.createHash('sha256').update(resultSummary).digest('hex');
      const record={receiptId,jobId:msg.jobId,eventId:msg.eventId,resultDigest,resultSummary,
                    receivedAt:new Date().toISOString(),state:'RECEIVED_UNVERIFIED',
                    ...(attestation?{deviceId:attestation.deviceId,deviceAction:attestation.deviceAction,
                      evidence:attestation.evidence,source:attestation.source}:{})};
      try { fs.writeFileSync(destination,JSON.stringify(record),{flag:'wx',mode:0o600}); }
      catch(e) {
        if(e.code!=='EEXIST') throw e;
        const prior=JSON.parse(fs.readFileSync(destination,'utf8'));
        if(prior.jobId !== msg.jobId || prior.eventId !== msg.eventId ||
           crypto.createHash('sha256').update(prior.resultSummary).digest('hex') !== resultDigest)
          return reply(res,409,{accepted:false,error:'event_content_conflict'});
        return reply(res,200,{accepted:true,duplicate:true,receiptId,status:'RECEIVED_UNVERIFIED'});
      }
      return reply(res,202,{accepted:true,receiptId,status:'RECEIVED_UNVERIFIED'});
    } catch {return reply(res,400,{error:'malformed_request'});}
  });
});
server.listen(port,'127.0.0.1',()=>console.log('DEV intake on loopback:'+port));
