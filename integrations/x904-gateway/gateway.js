'use strict';
require('dotenv').config({path: require('node:path').join(__dirname,'.env')});
const axios = require('axios');
const {loadState,previewDelta} = require('./queue-safety');
const ZKLib = require('node-zklib');
const constants = require('node-zklib/constants.js');
const ip = process.env.X904_DEVICE_IP || '192.168.100.185';
const port = Number(process.env.X904_DEVICE_PORT || 4370);
const serial = process.env.X904_DEVICE_SERIAL || 'TDBD234200545';
const target = process.env.X904_INGRESS_URL || 'https://sc.travelintrips.co.id/internal/gym-x904/events';
const sendEnabled = process.env.X904_SEND_ENABLED === 'true';

function ensureSafeConfig() {
  if (!/^192\.168\.100\.\d{1,3}$/.test(ip) || port !== 4370) throw Error('INVALID_DEVICE_TARGET');
  if (sendEnabled) throw Error('SEND_LOCKED_PENDING_TRUSTED_GATEWAY_REVIEW');
}
function buildAuthKey(text, sessionId) {
  if (typeof text !== 'string' || !/^\d{1,10}$/.test(text) || BigInt(text)>4294967295n) throw Error('INVALID_COMM_KEY');
  let n=BigInt(text),k=0n;
  for(let i=0n;i<32n;i++)k=(k<<1n)|((n>>i)&1n);
  const v=Number((k+BigInt(sessionId??0))&0xffffffffn);
  const b=Buffer.alloc(4);b.writeUInt32LE(v);
  for(let i=0;i<4;i++)b[i]^=[90,75,83,79][i];
  return Buffer.from([b[2]^50,b[3]^50,50,b[1]^50]);
}
async function readAttendance() {
  const commKey=process.env.X904_DEVICE_COMM_KEY;
  if (!commKey) throw Error('COMM_KEY_NOT_CONFIGURED_ON_VMSC');
  const device=new ZKLib(ip,port,8000,4000);
  try {
    await device.createSocket();
    const tcp=device.zklibTcp;
    const reply=await tcp.executeCmd(constants.COMMANDS.CMD_AUTH,buildAuthKey(commKey,tcp.sessionId));
    if(!Buffer.isBuffer(reply)||reply.length<2||reply.readUInt16LE(0)!==2000)throw Error('DEVICE_AUTH_FAILED');
    console.log('CONNECTION_SUCCESS authenticated=true');
    const info=await tcp.executeCmd(constants.COMMANDS.CMD_GET_FREE_SIZES,'');
    if(!Buffer.isBuffer(info)||info.length<44||info.readUInt16LE(0)!==2000)throw Error('DEVICE_INFO_FAILED');
    const expected=info.readUInt32LE(40);
    // A failed transfer invalidates this transport; main() reconnects for retries.
    let response;
    try {
      response=await tcp.getAttendances(()=>{});
    } catch (error) {
      const code=typeof error?.code==='string' ? error.code.replace(/[^A-Z0-9_]/gi,'').slice(0,36) : 'SDK_THROW';
      throw Error('ATTENDANCE_READ_FAILED:'+code);
    }
    if(response?.err||!Array.isArray(response?.data)){console.log('[X904] transfer_result='+ (response?.err ? 'sdk-error' : 'missing-data'));throw Error('ATTENDANCE_READ_FAILED');}
    if(response.data.length!==expected)throw Error('ATTENDANCE_COUNT_MISMATCH');
    return response.data;
  }finally{await device.disconnect().catch(()=>{});}
}
// FUTURE NORMALIZATION NOTE — DUMMY/SIMULATION ONLY, NEVER PRODUCTION:\r\n// Example display-only fallback: status: log.status ?? 0, verify: log.verify ?? 1\r\n// Those are SYNTHETIC values and do not prove device event status or method.\r\n// Do not send fallback records to postTrustedEvents, Axios, check-in or ledger.\r\n// Missing status/verify must be quarantined until real authenticated ADMS\r\n// evidence, source provenance and deduplication are verified.\r\n// Keep X904_SEND_ENABLED=false until explicit production approval.\r\n// Prepared interface only: cannot transmit until an authenticated gateway
// verifies the physical device and an explicit release removes the lock.
async function postTrustedEvents(events, physicalIdentityVerified) {
  if (!sendEnabled || physicalIdentityVerified !== true) throw Error('TRUST_NOT_VERIFIED');
  const key = process.env.GYM_X904_EVENT_INGEST_KEY;
  if (!key || key.length < 32) throw Error('MISSING_TRUSTED_INGRESS_KEY');
  if (new URL(target).origin !== 'https://sc.travelintrips.co.id') throw Error('INVALID_INGRESS_TARGET');
  // Only canonical authenticated ADMS events are permitted (not raw SDK uid/timestamp).
  if (!Array.isArray(events) || !events.every(e => /^[a-f0-9]{64}$/.test(e.id) && typeof e.pin === "string" && Number.isInteger(e.status) && Number.isInteger(e.verify) && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(e.occurred))) throw Error("INVALID_CANONICAL_EVENTS");
  return axios.post(target,{serial,events},{
    timeout:15000,maxRedirects:0,
    headers:{'x-gym-ingress-key':key,'Content-Type':'application/json'}
  });
}
async function main() {
  ensureSafeConfig();
  console.log('[X904] DRY_RUN_ONLY: read device, do not upload');
  let rows;
  for(let attempt=1;attempt<=3;attempt++){
    try{rows=await readAttendance();break;}catch(error){
      console.log('[X904] read_attempt='+attempt+' failed code='+String(error?.message||'UNKNOWN').replace(/[^A-Z0-9_:]/gi,'').slice(0,72)+' (no changes made)');
      if(attempt===3)throw error;
      await new Promise(resolve=>setTimeout(resolve,2500));
    }
  }
  console.log('[X904] log_count='+rows.length+' (PINs and attendance details withheld)');
  const delta=previewDelta(rows,loadState());
  console.log('[X904] pendingForReview='+delta.pendingForReview+' baseline='+delta.baseline+' sendEnabled=false');
}
if(require.main===module) main().catch(error=>{
  console.error('[X904] error: '+(error instanceof Error ? error.message : 'UNKNOWN'));
  process.exitCode=1;
});
module.exports={readAttendance,postTrustedEvents};


