#!/usr/bin/env node
// DEV-only read-only metadata census. No browser access, transcript, prompt, token, or secret output.
// Does not authorize replay, retry, reader navigation, lease, dispatch, or ACK.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DIAG = /^READINESS_DIAG time=(\d+(?:\.\d+)?) phase=([a-z_]+) responding=(True|False) user_exact=(True|False) wake_exact=(True|False) attest_exact=(True|False) assistant_ack_visible=(True|False) user_occurrences=(\d+) snapshot_chars=(\d+) message_chars=(\d+) message_lines=(\d+) snapshot_lines=(\d+) collapsed_whitespace_occurrences=(\d+)$/;
const SAMPLES = /^READINESS_SAMPLES total=(\d+) stop_visible=(\d+) stop_absent=(\d+)$/;
const bool = x => x === 'True';
export function classifyReadiness(line, samplesLine) {
  const m = typeof line === 'string' ? DIAG.exec(line.trim()) : null;
  const s = typeof samplesLine === 'string' ? SAMPLES.exec(samplesLine.trim()) : null;
  if (!m || !s) return {ok:false, reason:'DIAGNOSTIC_FORMAT_UNVERIFIED'};
  const timestamp = Number(m[1]);
  const counts = [m[8],m[9],m[10],m[11],m[12],m[13],s[1],s[2],s[3]].map(Number);
  if (!Number.isFinite(timestamp) || timestamp < 0 || counts.some(n => !Number.isSafeInteger(n) || n < 0))
    return {ok:false,reason:'DIAGNOSTIC_NUMBERS_INVALID'};
  const [occurrences,snapshotChars,messageChars,messageLines,snapshotLines,collapsed,total,stopVisible,stopAbsent] = counts;
  if (total===0 || total!==stopVisible+stopAbsent || occurrences > snapshotChars || collapsed > snapshotChars || messageChars > 200000 || snapshotChars > 200000)
    return {ok:false, reason:'DIAGNOSTIC_COUNTS_INCONSISTENT'};
  const responding=bool(m[3]), userExact=bool(m[4]), wakeExact=bool(m[5]), attestExact=bool(m[6]), ackVisible=bool(m[7]);
  let reason='READY_FOR_AUTHORITATIVE_READER_ONLY';
  if (responding) reason='UI_STILL_RESPONDING';
  else if (!userExact || occurrences !== 1) reason='USER_TEXT_NOT_EXACTLY_VISIBLE';
  else if (!wakeExact || !attestExact) reason='WAKE_ATTEST_MARKER_NOT_UNIQUE';
  else if (!ackVisible) reason='ASSISTANT_ACK_NOT_VISIBLE';
  return {ok:true, timestampUtc:new Date(timestamp*1000).toISOString(), phase:m[2], reason,
    flags:{responding,userExact,wakeExact,attestExact,ackVisible},
    counts:{userOccurrences:occurrences,collapsedWhitespaceOccurrences:collapsed,readinessSamples:total,stopVisible,stopAbsent,messageLines,snapshotLines},
    // No transcript or token bytes can be emitted by this return value.
    authority:{nativeFinalVerified:false,issuerAuthorized:false,mayReplay:false,mayDispatch:false,mayCloseJob:false}};
}
export function scanLog(text) {
  if (typeof text !== 'string' || text.length > 10_000_000) return {ok:false,reason:'LOG_BOUND_EXCEEDED'};
  const lines=text.split(/\r?\n/), found=[];
  for(let i=0;i<lines.length;i++) {
    if (!lines[i].startsWith('READINESS_DIAG ')) continue;
    const next=lines.slice(i+1,i+3).find(l=>l.startsWith('READINESS_SAMPLES '));
    found.push(classifyReadiness(lines[i],next));
    if(found.length>5000) return {ok:false,reason:'DIAGNOSTIC_ROWS_EXCEEDED'};
  }
  return {ok:true,examined:found.length,results:found};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const file=process.argv[2];
  if(!file) {console.error('Usage: node gpt02-readiness-metadata-census.mjs <local-diagnostic-log>');process.exitCode=2;}
  else {
    try {const result=scanLog(readFileSync(file,'utf8'));console.log(JSON.stringify(result));if(!result.ok)process.exitCode=2;}
    catch {console.error('DIAGNOSTIC_INPUT_UNAVAILABLE');process.exitCode=2;}
  }
}
