const {evaluateRows}=require('./gpt02-passive-submit-rate-gate.cjs');
const now=Date.parse('2026-11-13T13:00:00Z');
const base={capturedAtUtc:'2026-11-13T12:59:30Z',eventPrefix:'0123456789abcdef',captureMode:'PASSIVE_SUBMIT_STREAM',responseStatus:429,retryAfterSeconds:40};
function check(name,rows,expect){const r=evaluateRows(rows,now);if(r.reason!==expect)throw Error(name+':'+JSON.stringify(r));console.log(name+'_PASS')}
check('NO_PASSIVE',[{responseStatus:429,capturedAtUtc:'2026-11-13T12:59:50Z',eventPrefix:'taskprobe'}],'PASSIVE_SUBMIT_RATE_GATE_CLEAR');
check('RETRY_ACTIVE',[base],'PASSIVE_PROVIDER_RETRY_AFTER_ACTIVE');
check('RETRY_AGED',[{...base,capturedAtUtc:'2026-11-13T12:58:00Z'}],'PASSIVE_SUBMIT_RATE_GATE_CLEAR');
check('REPEAT',[base,{...base,capturedAtUtc:'2026-11-13T12:59:20Z',eventPrefix:'fedcba9876543210'}],'PASSIVE_429_REPEAT_REMEDIATION_REQUIRED');
check('BAD_PREFIX',[{...base,eventPrefix:'nothex'}],'PASSIVE_RATE_EVIDENCE_INVALID');
