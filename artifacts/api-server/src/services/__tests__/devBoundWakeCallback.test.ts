// Offline fixtures: no browser, provider, DB connection, tokens or deployment.
import { afterEach, beforeEach, it as test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';

let settings = [];
let dispatches = [];
let commands = new Map();
let callbackRow = null;
let inserts = [];
let commits = 0;
let rollbacks = 0;
const tx = { execute: async () => ({rows:callbackRow ? [callbackRow] : []}), insert: () => ({values: value => {
  inserts.push(value); return {returning:async()=>[{id:'77777777-7777-4777-8777-777777777777',createdAt:new Date(),...value}]};
}}) };
const testDb = {
  execute: async () => ({rows:settings}),
  transaction: async callback => { try { const v=await callback(tx); commits++; return v; } catch(e) { rollbacks++; throw e; } },
  select: () => ({from:()=>({where:()=>({limit:async()=>[]})})}),
  update: () => ({set:()=>({where:async()=>{}})}),
};
const dispatch = async input => {
  dispatches.push(input);
  let existing=commands.get(input.externalCommandId);
  if(existing)return {created:false,clientId:input.clientId,command:existing};
  const command={id:'88888888-8888-4888-8888-888888888888',source:input.source,commandType:'EXTERNAL_AGENT_WORK',instruction:input.instruction,
    metadataJson:{...input.metadata,assignedClientId:input.clientId}};
  commands.set(input.externalCommandId,command); return {created:true,clientId:input.clientId,command};
};
vi.mock("@workspace/db", () => ({ db: testDb, aiCodingBridgeCommandsTable: {}, aiCodingBridgePresenceTable: {}, aiCodingBridgeResponsesTable: {} }));
vi.mock("../externalAgentDispatchService.js", () => ({ dispatchExternalAgentWork: (input: unknown) => dispatch(input) }));
vi.mock("../aiEventBusService.js", () => ({ publishSafe: () => {} }));
vi.mock("../aiCoreMcpEventWebhookService.js", () => ({ enqueueAiCoreMcpBridgeLifecycleEvent: async () => {} }));
vi.mock("../codingWhatsappNotificationService.js", () => ({ notifyCodingBridgeResponse: async () => ({status: "skipped"}), waitForCodingWhatsappDelivery: async () => null }));
vi.mock("../aiCoreChatInboxService.js", () => ({ enqueueAiCoreChatInboxMessage: async () => {} }));
vi.mock("../codingControlBridgeSchemaService.js", () => ({ ensureCodingControlBridgeTables: async () => {} }));
vi.mock("../gcpCodingWorkerLifecycleService.js", () => ({ ensureGcpCodingWorkerStarted: async () => {} }));
vi.mock("../externalAgentWorkEventService.js", () => ({ notifyExternalAgentWork: async () => {} }));
const binding = await import('../devChatGptWakeBindingService.js');
const attestation = await import('../devAssistantAttestation.js');
const evidence = await import('../devChatGptWakeEvidenceService.js');
const wake = await import('../devChatGptWakeService.js');
const bridge = await import('../localCodingControlBridgeService.js');
const events = await import('../devContinuityWakeEvents.js');
const legacy={ownerChannel:'ai-engine-oauth:'+'a'.repeat(64),targetConversationId:'11111111-1111-4111-8111-111111111111',workerId:binding.DEV_WAKE_DELL_WORKER};
const entry={accountAlias:'GPT02',ownerChannel:'ai-engine-oauth:'+'d'.repeat(64),targetConversationId:'22222222-2222-4222-8222-222222222222',workerId:binding.DEV_WAKE_DELL_WORKER,browserProfile:'travelincars-dev',enabled:true};
const raw = entries => JSON.stringify({version:1,bindings:entries??[entry]});
const wb=binding.parseDevWakeAccountBindings(raw(),legacy)[0];
const expected={ownerChannel:entry.ownerChannel,targetConversationId:entry.targetConversationId,workerId:entry.workerId,eventId:'b'.repeat(64),bindingFingerprint:wb.bindingFingerprint,browserProfile:entry.browserProfile};
const meta={conversationId:entry.ownerChannel,targetConversationId:entry.targetConversationId,assignedClientId:entry.workerId,eventId:expected.eventId,
  capability:'chatgpt:wake',explicitWorkerTarget:true,devOnly:true,wakeBinding:wb,assistantAttestationChallenge:attestation.deriveDevAssistantChallenge(expected)};
const pair=generateKeyPairSync('ed25519');
const publicKey=pair.publicKey.export({format:'der',type:'spki'}).toString('base64');
function receipt(metadata=meta, bound=true){
  const expectation=evidence.devWakeAttestationExpected(metadata);
  const now=new Date().toISOString();
  const unsigned={version:bound?2:1,algorithm:'Ed25519',keyId:attestation.DEV_DELL_ASSISTANT_ATTESTATION_KEY_ID,workerId:entry.workerId,
    conversationId:metadata.targetConversationId,eventId:metadata.eventId,challenge:attestation.deriveDevAssistantChallenge(expectation),assistantMessageId:'44444444-4444-4444-8444-444444444444',
    assistantResponseHash:'c'.repeat(64),observedAt:now,...(bound?{bindingFingerprint:wb.bindingFingerprint,browserProfile:entry.browserProfile}:{})};
  return {conversationId:metadata.targetConversationId,eventId:metadata.eventId,browserConfirmed:true,browserPairingVerified:true,chatgptSubmitted:true,verifiedAssistantReply:true,exitCode:0,
    evidenceFingerprint:'e'.repeat(64),verifiedAt:now,attestation:{...unsigned,signature:sign(null,Buffer.from(attestation.devAssistantAttestationPayload(unsigned)),pair.privateKey).toString('base64')}};
}
afterEach(() => vi.unstubAllEnvs());
beforeEach(()=>{
  settings=[];dispatches=[];commands.clear();callbackRow=null;inserts=[];commits=0;rollbacks=0;
  vi.stubEnv('APP_ENV', 'development');vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('AI_CORE_DEV_BROWSER_WAKE_ENABLED', 'true');vi.stubEnv('AI_CORE_DEV_BROWSER_WAKE_CHANNELS', legacy.ownerChannel);
  vi.stubEnv('AI_CORE_DEV_BROWSER_WAKE_CONVERSATIONS', legacy.targetConversationId);vi.stubEnv('AI_CORE_DEV_BROWSER_WAKE_WORKER_ID', entry.workerId);
  vi.stubEnv('AI_CORE_DEV_DELL_ASSISTANT_ATTESTATION_PUBLIC_KEY_DER_B64', publicKey);
  vi.stubEnv('AI_CORE_DEV_BROWSER_WAKE_ACCOUNT_BINDINGS_JSON', raw());
});
test('cross-language fingerprint and both challenge vectors',()=>{
  assert.equal(wb.bindingFingerprint,'4da956549aa62bb6e42bdc4ab13390d2b137d29940e2bb6a89134dfc2f0dbec1');
  assert.equal(attestation.deriveDevAssistantChallenge(expected),'2a4c9bcdf77cb321930750a835f29cd065d70c1ea8b20f8a4c302853b6267a2a');
  assert.equal(attestation.deriveDevAssistantChallenge({...expected,watchCommandId:'55555555-5555-4555-8555-555555555555',jobId:'66666666-6666-4666-8666-666666666666',checkpointRevision:7}),'79960f0819bca525e9f2930fc13b4c94b538c06fc0860686b4d051f84d53feec');
});
test('exact pair only, dormant config and protected GPT01',async()=>{
  assert.equal(await wake.isDevBrowserWakeAllowed(entry),true);assert.equal(await wake.isDevBrowserWakeAllowed(legacy),true);
  assert.equal(await wake.isDevBrowserWakeAllowed({...entry,ownerChannel:legacy.ownerChannel}),false);
  assert.equal(await wake.isDevBrowserWakeAllowed({...legacy,ownerChannel:entry.ownerChannel}),false);
  vi.stubEnv('AI_CORE_DEV_BROWSER_WAKE_ACCOUNT_BINDINGS_JSON', raw([{...entry,enabled:false}]));assert.equal(await wake.isDevBrowserWakeAllowed(entry),false);
  vi.stubEnv('AI_CORE_DEV_BROWSER_WAKE_ACCOUNT_BINDINGS_JSON', raw([{...entry,ownerChannel:legacy.ownerChannel}]));assert.equal(await wake.isDevBrowserWakeAllowed(entry),false);assert.equal(await wake.isDevBrowserWakeAllowed(legacy),true);
});
test('keeps both existing legacy owners with no additional binding configured',async()=>{
  const other={...legacy,ownerChannel:'ai-engine-oauth:'+'c'.repeat(64)};
  vi.stubEnv('AI_CORE_DEV_BROWSER_WAKE_CHANNELS',legacy.ownerChannel+','+other.ownerChannel);
  vi.stubEnv('AI_CORE_DEV_BROWSER_WAKE_ACCOUNT_BINDINGS_JSON','');
  // The existing environment list takes precedence over the single central owner.
  settings=[{key:'dev.chatgpt_wake.owner_channel',value:legacy.ownerChannel}];
  assert.equal(await wake.isDevBrowserWakeAllowed(legacy),true);
  assert.equal(await wake.isDevBrowserWakeAllowed(other),true);
  assert.deepEqual(await binding.allowedDevWakeOwners(),[legacy.ownerChannel,other.ownerChannel]);
  assert.equal(await wake.isDevBrowserWakeAllowed(entry),false);
  assert.equal(await wake.isDevBrowserWakeAllowed({...legacy,ownerChannel:entry.ownerChannel}),false);
});
test('two legacy owners keep separate v1 receipts while the additional account remains isolated',async()=>{
  const other={...legacy,ownerChannel:'ai-engine-oauth:'+'c'.repeat(64)};
  vi.stubEnv('AI_CORE_DEV_BROWSER_WAKE_CHANNELS',legacy.ownerChannel+','+other.ownerChannel);
  const legacyMetadata=[];
  for(const owner of [legacy,other]){
    await wake.queueDevBrowserWake({...owner,eventId:expected.eventId});
    const request=dispatches.at(-1);
    assert.equal(request.metadata.conversationId,owner.ownerChannel);
    assert.equal(request.metadata.wakeBinding,undefined);
    legacyMetadata.push({...request.metadata,assignedClientId:owner.workerId});
  }
  await wake.queueDevBrowserWake({...entry,eventId:expected.eventId});
  assert.deepEqual(dispatches.at(-1).metadata.wakeBinding,wb);
  assert.equal(commands.size,3);
  for(const owner of [legacy,other])assert.equal(await wake.isDevBrowserWakeAllowed({...entry,ownerChannel:owner.ownerChannel}),false);
  assert.equal(await wake.isDevBrowserWakeAllowed({...legacy,ownerChannel:entry.ownerChannel}),false);
  const [first,second]=legacyMetadata;
  assert.notEqual(first.assistantAttestationChallenge,second.assistantAttestationChallenge);
  const args={metadata:second,notBefore:new Date(Date.now()-1000).toISOString(),receivedAt:new Date().toISOString(),publicKeyDerBase64:publicKey};
  assert.equal(evidence.verifyDevWakeCommandReceipt({...args,details:receipt(first,false)}).verified,false);
  const details=receipt(second,false);
  assert.equal(evidence.verifyDevWakeCommandReceipt({...args,details}).verified,true);
  callbackRow={id:'88888888-8888-4888-8888-888888888888',source:'ai-core',command_type:'EXTERNAL_AGENT_WORK',metadata_json:second,received_at:new Date(Date.now()-1000)};
  const result=await bridge.completeCodingBridgeCommand({clientId:other.workerId,commandId:callbackRow.id,claimToken:'lease',status:'COMPLETED',message:'test',details});
  assert.equal(result.status,'COMPLETED');assert.equal(commits,1);assert.equal(inserts.length,1);
});
test('reserves every legacy owner and never expands multiple target lists',async()=>{
  const other={...legacy,ownerChannel:'ai-engine-oauth:'+'c'.repeat(64)};
  vi.stubEnv('AI_CORE_DEV_BROWSER_WAKE_CHANNELS',legacy.ownerChannel+','+other.ownerChannel);
  vi.stubEnv('AI_CORE_DEV_BROWSER_WAKE_ACCOUNT_BINDINGS_JSON',raw([{...entry,ownerChannel:other.ownerChannel}]));
  assert.equal(await wake.isDevBrowserWakeAllowed(legacy),true);
  assert.equal(await wake.isDevBrowserWakeAllowed(other),true);
  assert.equal(await wake.isDevBrowserWakeAllowed(entry),false);
  assert.equal(await wake.isDevBrowserWakeAllowed({...entry,ownerChannel:other.ownerChannel}),false);
  vi.stubEnv('AI_CORE_DEV_BROWSER_WAKE_ACCOUNT_BINDINGS_JSON',raw());
  vi.stubEnv('AI_CORE_DEV_BROWSER_WAKE_CONVERSATIONS',legacy.targetConversationId+','+entry.targetConversationId);
  for(const target of [legacy,other,entry])assert.equal(await wake.isDevBrowserWakeAllowed(target),false);
  assert.equal(dispatches.length,0);
});
test('legacy aliases require the exact caller and its signed final ACK',async()=>{
  const other={...legacy,ownerChannel:'ai-engine-oauth:'+'c'.repeat(64)};
  vi.stubEnv('AI_CORE_DEV_BROWSER_WAKE_CHANNELS',legacy.ownerChannel+','+other.ownerChannel);
  await assert.rejects(wake.resolveVerifiedDevWakeTarget('GPT01'),/ALIAS_OWNER_REQUIRED/);
  await assert.rejects(wake.resolveVerifiedDevWakeTarget('GPT01',undefined,entry.ownerChannel),/ALIAS_OWNER_MISMATCH/);
  assert.equal(commits,0);
  for(const target of [legacy,other]){
    await wake.queueDevBrowserWake({...target,eventId:expected.eventId});
    const metadata={...dispatches.at(-1).metadata,assignedClientId:target.workerId};
    const responseId='77777777-7777-4777-8777-777777777777';
    callbackRow={command_id:'88888888-8888-4888-8888-888888888888',command_received_at:new Date(Date.now()-1000),
      command_metadata_json:{...metadata,completedBy:target.workerId,mcpAckConversationId:target.ownerChannel,
        deliveryCode:'DELIVERY_CONFIRMED',e2eCode:'MCP_ACK_VERIFIED',mcpAckResponseId:responseId},
      response_id:responseId,response_metadata_json:{...receipt(metadata,false),deliveryCode:'DELIVERY_CONFIRMED',e2eCode:'E2E_VERIFIED'},
      response_created_at:new Date(),acknowledged_at:new Date()};
    assert.deepEqual(await wake.resolveVerifiedDevWakeTarget('GPT01',undefined,target.ownerChannel),target);
    const wrongOwner=target.ownerChannel===legacy.ownerChannel?other.ownerChannel:legacy.ownerChannel;
    await assert.rejects(wake.resolveVerifiedDevWakeTarget('GPT01',undefined,wrongOwner),/ALIAS_TARGET_UNVERIFIED/);
  }
  // Revoking one owner does not revoke the other or expose its receipt to GPT02.
  vi.stubEnv('AI_CORE_DEV_BROWSER_WAKE_CHANNELS',other.ownerChannel);
  assert.deepEqual(await wake.resolveVerifiedDevWakeTarget('GPT01'),other);
  assert.equal(await wake.isDevBrowserWakeAllowed(legacy),false);
  assert.deepEqual(await wake.resolveVerifiedDevWakeTarget('GPT02',undefined,entry.ownerChannel),{
    ownerChannel:entry.ownerChannel,targetConversationId:entry.targetConversationId,workerId:entry.workerId,wakeBinding:wb
  });
});
test('strict schema, aliases, case-insensitive profile conflict and malformed values',()=>{
  for(const change of [{accountAlias:'GPT01'},{browserProfile:'OPENCLAW'},{ownerChannel:entry.ownerChannel+'\n'},{browserProfile:'../unsafe'},{enabled:undefined},{targetConversationId:''}])assert.throws(()=>binding.parseDevWakeAccountBindings(raw([{...entry,...change}]),legacy));
  assert.throws(()=>binding.parseDevWakeAccountBindings(raw([entry,{...entry,accountAlias:'GPT03',ownerChannel:'ai-engine-oauth:'+'e'.repeat(64),targetConversationId:'33333333-3333-4333-8333-333333333333',browserProfile:'TRAVELINCARS-DEV'}]),legacy));
});
test('central and env gates are consistent and explicit false revokes',async()=>{
  vi.stubEnv('AI_CORE_DEV_BROWSER_WAKE_ACCOUNT_BINDINGS_JSON', '');vi.stubEnv('AI_CORE_DEV_BROWSER_WAKE_ENABLED', '');
  settings=[{key:'dev.chatgpt_wake.enabled',value:'true'},{key:'dev.chatgpt_wake.account_bindings',value:raw()}];
  assert.equal(await wake.isDevBrowserWakeAllowed(entry),true);
  vi.stubEnv('AI_CORE_DEV_BROWSER_WAKE_ENABLED', 'false');assert.equal(await wake.isDevBrowserWakeAllowed(entry),false);
  await assert.rejects(wake.queueDevBrowserWake({...entry,eventId:expected.eventId}),/DEV_CHATGPT_WAKE_DENIED/);
});
test('raw and retry bind profile, preserve idempotent event, reject downgrade',async()=>{
  const input={ownerChannel:entry.ownerChannel,targetConversationId:entry.targetConversationId,eventId:expected.eventId};
  const first=await wake.queueDevBrowserWake(input);assert.equal(first.created,true);assert.deepEqual(dispatches[0].metadata.wakeBinding,wb);
  assert.equal(dispatches[0].metadata.assistantAttestationChallenge,meta.assistantAttestationChallenge);
  const second=await wake.queueDevBrowserWake(input);assert.equal(second.created,false);assert.equal(commands.size,1);
  commands.values().next().value.metadataJson.wakeBinding=undefined;
  await assert.rejects(wake.queueDevBrowserWake(input),/RECONCILIATION_UNVERIFIED/);
  await assert.rejects(wake.queueDevBrowserWake({...input,expectedBindingFingerprint:'f'.repeat(64)}),/BINDING_CHANGED/);
});
test('legacy GPT01 command and attestation remain v1 without new binding',async()=>{
  await wake.queueDevBrowserWake({...legacy,eventId:expected.eventId});
  assert.equal(dispatches[0].metadata.wakeBinding,undefined);
  const legacyMeta={...dispatches[0].metadata,assignedClientId:legacy.workerId};
  const details=receipt(legacyMeta,false);
  assert.equal(evidence.verifyDevWakeCommandReceipt({metadata:legacyMeta,details,notBefore:new Date(Date.now()-1000).toISOString(),receivedAt:new Date().toISOString(),publicKeyDerBase64:publicKey}).verified,true);
});
test('bound attestation rejects owner/target/profile/signature replay and legacy downgrade',()=>{
  const args={metadata:meta,details:receipt(),notBefore:new Date(Date.now()-1000).toISOString(),receivedAt:new Date().toISOString(),publicKeyDerBase64:publicKey};
  assert.equal(evidence.verifyDevWakeCommandReceipt(args).verified,true);
  for(const change of [{conversationId:legacy.ownerChannel},{targetConversationId:legacy.targetConversationId},{wakeBinding:undefined},{wakeBinding:{...wb,browserProfile:'other'}},{assistantAttestationChallenge:'f'.repeat(64)}])assert.equal(evidence.verifyDevWakeCommandReceipt({...args,metadata:{...meta,...change}}).verified,false);
  for(const change of [{version:1},{browserProfile:'other'},{bindingFingerprint:'f'.repeat(64)},{assistantResponseHash:'e'.repeat(64)}])assert.equal(evidence.verifyDevWakeCommandReceipt({...args,details:{...args.details,attestation:{...args.details.attestation,...change}}}).verified,false);
});
test('progress reads only exact owner and dedicated wake command',()=>{
  const command={source:'ai-core',commandType:'EXTERNAL_AGENT_WORK',metadataJson:meta};
  assert.equal(binding.isOwnedDevWakeProgressCommand(command,entry.ownerChannel),true);assert.equal(binding.isOwnedDevWakeProgressCommand(command,legacy.ownerChannel),false);
  assert.equal(binding.isOwnedDevWakeProgressCommand({...command,metadataJson:{...meta,assignedClientId:'openclaw-pc-worker-dell-browser'}},entry.ownerChannel),false);
});
test('callback mismatched profile rolls back before response insert',async()=>{
  callbackRow={id:'88888888-8888-4888-8888-888888888888',source:'ai-core',command_type:'EXTERNAL_AGENT_WORK',metadata_json:meta,received_at:new Date(Date.now()-1000)};
  const details=receipt();details.attestation.browserProfile='wrong';
  await assert.rejects(bridge.completeCodingBridgeCommand({clientId:entry.workerId,commandId:callbackRow.id,claimToken:'lease',status:'COMPLETED',message:'test',details}),/CALLBACK_ATTESTATION_INVALID/);
  assert.equal(inserts.length,0);assert.equal(commits,0);assert.equal(rollbacks,1);
});
test('callback missing or revoked binding cannot commit completed',async()=>{
  callbackRow={id:'88888888-8888-4888-8888-888888888888',source:'ai-core',command_type:'EXTERNAL_AGENT_WORK',metadata_json:{...meta,wakeBinding:undefined},received_at:new Date(Date.now()-1000)};
  await assert.rejects(bridge.completeCodingBridgeCommand({clientId:entry.workerId,commandId:callbackRow.id,claimToken:'lease',status:'COMPLETED',message:'test',details:receipt()}),/CALLBACK_BINDING_INVALID/);
  callbackRow.metadata_json=meta;vi.stubEnv('AI_CORE_DEV_BROWSER_WAKE_ACCOUNT_BINDINGS_JSON', raw([{...entry,enabled:false}]));
  await assert.rejects(bridge.completeCodingBridgeCommand({clientId:entry.workerId,commandId:callbackRow.id,claimToken:'lease',status:'COMPLETED',message:'test',details:receipt()}),/CALLBACK_BINDING_INVALID/);
  assert.equal(inserts.length,0);assert.equal(commits,0);
});
test('valid callback persists once and late callback with lost claim cannot insert',async()=>{
  callbackRow={id:'88888888-8888-4888-8888-888888888888',source:'ai-core',command_type:'EXTERNAL_AGENT_WORK',metadata_json:meta,received_at:new Date(Date.now()-1000)};
  const input={clientId:entry.workerId,commandId:callbackRow.id,claimToken:'lease',status:'COMPLETED',message:'test',details:receipt()};
  const result=await bridge.completeCodingBridgeCommand(input);assert.equal(result.status,'COMPLETED');assert.equal(inserts.length,1);assert.equal(commits,1);
  callbackRow=null;assert.equal(await bridge.completeCodingBridgeCommand(input),null);assert.equal(inserts.length,1);
});
test('handshake requires matching final ACK and signed bound profile',()=>{
  const details=receipt();const now=new Date();const responseId='77777777-7777-4777-8777-777777777777';
  const row={commandId:'88888888-8888-4888-8888-888888888888',commandReceivedAt:new Date(Date.now()-1000),
    commandMetadata:{...meta,completedBy:entry.workerId,mcpAckConversationId:entry.ownerChannel,deliveryCode:'DELIVERY_CONFIRMED',e2eCode:'MCP_ACK_VERIFIED',mcpAckResponseId:responseId},
    responseId,responseMetadata:{...details,deliveryCode:'DELIVERY_CONFIRMED',e2eCode:'E2E_VERIFIED'},responseCreatedAt:now,acknowledgedAt:now};
  assert.equal(bridge.verifyMcpHandshakeEvidenceRow(entry.ownerChannel,row,publicKey)?.wakeBinding.bindingFingerprint,wb.bindingFingerprint);
  assert.equal(bridge.verifyMcpHandshakeEvidenceRow(legacy.ownerChannel,row,publicKey),null);
  assert.equal(bridge.verifyMcpHandshakeEvidenceRow(entry.ownerChannel,{...row,responseId:'wrong'},publicKey),null);
  assert.equal(bridge.verifyMcpHandshakeEvidenceRow(entry.ownerChannel,{...row,commandMetadata:{...row.commandMetadata,wakeBinding:undefined}},publicKey),null);
});

test('continuity context drift is rejected by receipt, callback, restore and retry', async () => {
  const input = { ownerChannel:entry.ownerChannel, targetConversationId:entry.targetConversationId, eventId:expected.eventId,
    watchCommandId:'55555555-5555-4555-8555-555555555555', jobId:'66666666-6666-4666-8666-666666666666',
    checkpointRevision:7, expiresAt:'2099-01-01T00:00:00.000Z' };
  await wake.queueDevBrowserWake(input);
  const [key, command] = commands.entries().next().value;
  const good = command.metadataJson;
  const details = receipt(good);
  const event = metadata => events.devContinuityResultFromCommittedCommand({ id:command.id, source:'ai-core',
    commandType:'EXTERNAL_AGENT_WORK', authenticatedWorkerId:entry.workerId, status:'COMPLETED', details,
    metadata:{...metadata, completedBy:entry.workerId} });
  const verify = metadata => evidence.verifyDevWakeCommandReceipt({ metadata, details, publicKeyDerBase64:publicKey,
    notBefore:new Date(Date.now()-1000).toISOString(), receivedAt:new Date().toISOString() }).verified;
  assert.equal(verify(good), true);
  assert.ok(event(good));
  assert.equal((await wake.queueDevBrowserWake(input)).created, false);
  const changed = [
    {...good, watchCommandId:'77777777-7777-4777-8777-777777777777'},
    {...good, jobId:'77777777-7777-4777-8777-777777777777'},
    {...good, checkpointRevision:8},
    {...good, watchCommandId:undefined, jobId:undefined, checkpointRevision:undefined},
    {...good, devContinuity:undefined},
    {...good, devContinuity:{...good.devContinuity, assistantAttestationChallenge:'f'.repeat(64)}},
  ];
  for (const metadata of changed) {
    assert.equal(evidence.devWakeAttestationExpected(metadata), null);
    assert.equal(verify(metadata), false);
    assert.equal(event(metadata), null);
    commands.set(key, {...command, metadataJson:metadata});
    await assert.rejects(wake.queueDevBrowserWake(input), /RECONCILIATION_UNVERIFIED/);
  }
  assert.equal(evidence.devWakeAttestationExpected({...meta, watchCommandId:input.watchCommandId}), null);
  assert.equal(evidence.devWakeAttestationExpected({...meta, devContinuity:{ownerChannel:entry.ownerChannel,
    eventId:expected.eventId, assistantAttestationChallenge:meta.assistantAttestationChallenge}}), null);
  callbackRow = { id:command.id, source:'ai-core', command_type:'EXTERNAL_AGENT_WORK', metadata_json:changed[0],
    received_at:new Date(Date.now()-1000) };
  const committedBefore = commits;
  await assert.rejects(bridge.completeCodingBridgeCommand({ clientId:entry.workerId, commandId:command.id,
    claimToken:'lease', status:'COMPLETED', message:'test', details }), /CALLBACK_ATTESTATION_INVALID/);
  assert.equal(commits, committedBefore); assert.equal(inserts.length, 0); assert.equal(rollbacks, 1);
});
