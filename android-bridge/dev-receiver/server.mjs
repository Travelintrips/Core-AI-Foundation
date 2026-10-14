// DEV-only intake. Bind to loopback; require TLS at the reverse proxy.
// No AI Core service secrets are exposed to an Android client.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const secret = process.env.BRIDGE_DEVICE_HMAC_SECRET || '';
if (Buffer.byteLength(secret) < 32) throw Error('BRIDGE_DEVICE_HMAC_SECRET must be 32+ bytes');
const spoolDir = process.env.BRIDGE_DEVICE_SPOOL_DIR || '/var/lib/openclaw-android-bridge-dev';
const port = Number(process.env.BRIDGE_DEVICE_PORT || '18798');
const used = new Map();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const equal = (x,y) => { const a=Buffer.from(x),b=Buffer.from(y);return a.length===b.length && crypto.timingSafeEqual(a,b); };
const sign = raw => crypto.createHmac('sha256',secret).update(raw).digest('base64url');
function verify(rawToken, jobId) {
  if (typeof rawToken !== 'string' || rawToken.length > 1500) return false;
  const parts = rawToken.split('.');
  if (parts.length !== 2 || !equal(sign(parts[0]),parts[1])) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    return payload.scope === 'android-result:submit' && payload.jobId === jobId &&
      Number.isInteger(payload.exp) && payload.exp >= Date.now() && payload.exp <= Date.now()+15*60*1000 &&
      typeof payload.nonce === 'string' && payload.nonce.length > 10;
  } catch { return false; }
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
      if (!verify(authorization.slice(7),msg.jobId)) return reply(res,401,{error:'invalid_or_expired_job_token'});
      // Durable no-overwrite idempotent inbox for a future trusted server-side bridge consumer.
      const receiptId=crypto.createHash('sha256').update(msg.jobId+'|'+msg.eventId).digest('hex');
      const destination=path.join(spoolDir,receiptId+'.json');
      const record={receiptId,jobId:msg.jobId,eventId:msg.eventId,resultSummary:msg.resultSummary,
                    receivedAt:new Date().toISOString(),state:'RECEIVED_UNVERIFIED'};
      try { fs.writeFileSync(destination,JSON.stringify(record),{flag:'wx',mode:0o600}); }
      catch(e) { if(e.code!=='EEXIST') throw e; return reply(res,200,{accepted:true,duplicate:true,receiptId,status:'RECEIVED_UNVERIFIED'}); }
      return reply(res,202,{accepted:true,receiptId,status:'RECEIVED_UNVERIFIED'});
    } catch {return reply(res,400,{error:'malformed_request'});}
  });
});
server.listen(port,'127.0.0.1',()=>console.log('DEV intake on loopback:'+port));
