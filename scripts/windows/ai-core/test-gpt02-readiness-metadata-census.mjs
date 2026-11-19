import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyReadiness,scanLog} from './gpt02-readiness-metadata-census.mjs';
const line = 'READINESS_DIAG time=1794078278.5030818 phase=assistant_readiness responding=False user_exact=True wake_exact=True attest_exact=True assistant_ack_visible=False user_occurrences=1 snapshot_chars=8278 message_chars=525 message_lines=0 snapshot_lines=137 collapsed_whitespace_occurrences=1';
const samples='READINESS_SAMPLES total=192 stop_visible=89 stop_absent=103';
test('historical Job135 metadata classifies missing visible ACK without authority',()=>{
 const r=classifyReadiness(line,samples);
 assert.equal(r.ok,true);assert.equal(r.reason,'ASSISTANT_ACK_NOT_VISIBLE');
 assert.equal(r.counts.readinessSamples,192);
 assert.equal(r.authority.nativeFinalVerified,false);
 assert.equal(r.authority.mayReplay,false);
 assert.equal(JSON.stringify(r).includes('AI_CORE_'),false);
});
test('no incomplete sample row is accepted',()=>assert.equal(classifyReadiness(line,undefined).ok,false));
test('reject contradictory sample totals',()=>assert.equal(classifyReadiness(line,'READINESS_SAMPLES total=192 stop_visible=89 stop_absent=102').ok,false));
test('reject malformed or contaminated raw metadata',()=>assert.equal(classifyReadiness(line+' secret',samples).ok,false));
test('responding takes priority',()=>assert.equal(classifyReadiness(line.replace('responding=False','responding=True'),samples).reason,'UI_STILL_RESPONDING'));
test('missing wake marker takes priority over missing ACK',()=>assert.equal(classifyReadiness(line.replace('wake_exact=True','wake_exact=False'),samples).reason,'WAKE_ATTEST_MARKER_NOT_UNIQUE'));
test('wrong user text is distinct',()=>assert.equal(classifyReadiness(line.replace('user_exact=True','user_exact=False'),samples).reason,'USER_TEXT_NOT_EXACTLY_VISIBLE'));
test('ready UI never claims native final verification',()=>{
 const r=classifyReadiness(line.replace('assistant_ack_visible=False','assistant_ack_visible=True'),samples);
 assert.equal(r.reason,'READY_FOR_AUTHORITATIVE_READER_ONLY');assert.equal(r.authority.nativeFinalVerified,false);
});
test('read-only scan skips unrelated lines and preserves bounded output',()=>{
 const r=scanLog('other log\n'+line+'\n'+samples+'\n');assert.equal(r.examined,1);assert.equal(r.results[0].reason,'ASSISTANT_ACK_NOT_VISIBLE');
});
test('reject unbounded input',()=>assert.equal(scanLog('x'.repeat(10_000_001)).ok,false));
test('reject missing counters',()=>assert.equal(classifyReadiness(line.replace('snapshot_chars=8278','snapshot_chars=NaN'),samples).ok,false));
test('reject zero sample count',()=>assert.equal(classifyReadiness(line,'READINESS_SAMPLES total=0 stop_visible=0 stop_absent=0').ok,false));
