#!/usr/bin/env node
// Owner-scoped OAuth MCP ACK verifier. No browser automation, no token persistence.
const required = ['AI_CORE_MCP_URL','AI_CORE_OAUTH_ACCESS_TOKEN','AI_CORE_OWNER_CHANNEL','AI_CORE_RESPONSE_ID','AI_CORE_COMMAND_ID','AI_CORE_EVENT_ID','AI_CORE_TARGET_CONVERSATION_ID'];
for (const key of required) if (!process.env[key]) throw Error('MISSING_'+key);
const env = process.env;
const url = new URL(env.AI_CORE_MCP_URL);
if (url.protocol !== 'https:' || !['dev.cstlogistic.co.id','dev-aicore.cstlogistic.co.id'].includes(url.hostname) || url.pathname !== '/api/ai/core-chat/mcp') throw Error('DEV_MCP_URL_REQUIRED');
if (!/^[0-9a-f-]{36}$/i.test(env.AI_CORE_RESPONSE_ID) || !/^[0-9a-f-]{36}$/i.test(env.AI_CORE_COMMAND_ID) || !/^[a-f0-9]{64}$/i.test(env.AI_CORE_EVENT_ID)) throw Error('INVALID_EVIDENCE_IDENTIFIERS');
let counter = 0;
async function call(name,args) {
  const response = await fetch(url,{method:'POST',headers:{authorization:'Bearer '+env.AI_CORE_OAUTH_ACCESS_TOKEN,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:++counter,method:'tools/call',params:{name,arguments:args}}),signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw Error('MCP_HTTP_'+response.status);
  const raw = await response.text();
  let rpc;
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    const data = raw.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).filter(Boolean);
    rpc = JSON.parse(data.at(-1) ?? '{}');
  } else rpc = JSON.parse(raw);
  if (rpc.error || rpc.result?.isError || !rpc.result?.structuredContent) throw Error('MCP_TOOL_ERROR_'+name);
  return rpc.result.structuredContent;
}
const channel = env.AI_CORE_OWNER_CHANNEL;
const expected = env.AI_CORE_RESPONSE_ID;
const matches = e => e?.id === expected && e.commandId === env.AI_CORE_COMMAND_ID && e.kind === 'COMPLETED' && e.metadata?.eventId === env.AI_CORE_EVENT_ID && e.metadata?.conversationId === env.AI_CORE_TARGET_CONVERSATION_ID && e.metadata?.e2eCode === 'E2E_VERIFIED' && e.metadata?.verifiedAssistantReply === true;
const read = await call('read_ai_core_events',{conversationId:channel,limit:100});
if (read.conversationId !== channel) throw Error('OWNER_CHANNEL_MISMATCH');
const matching = (read.events ?? []).filter(matches);
if (matching.length !== 1) throw Error('EVIDENCE_NOT_UNIQUE_OR_MISSING');
if (env.AI_CORE_ACK_EXECUTE !== 'true') { console.log(JSON.stringify({status:'READ_VERIFIED_ACK_NOT_SENT',responseId:expected})); process.exit(0); }
const ack = await call('ack_ai_core_event',{conversationId:channel,responseId:expected});
if (ack.acknowledged !== true || ack.responseId !== expected) throw Error('ACK_NOT_CONFIRMED');
const after = await call('read_ai_core_events',{conversationId:channel,limit:100});
if (after.conversationId !== channel || (after.events ?? []).some(e=>e?.id===expected)) throw Error('ACK_READBACK_NOT_CONFIRMED');
console.log(JSON.stringify({status:'ACK_READBACK_VERIFIED',responseId:expected}));
