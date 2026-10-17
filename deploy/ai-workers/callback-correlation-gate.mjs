// DEV-only correlation and authenticated handoff gate. Does NOT attest ChatGPT browser sessions.
import { randomUUID, timingSafeEqual } from 'node:crypto';
const eq=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function newCorrelation({jobId,environment='DEV'}) {
 if(environment!=='DEV'||!jobId) throw Error('DEV job required');
 return {jobId,environment,commandId:randomUUID(),nonce:randomUUID(),state:'DISPATCHED'};
}
export function acceptWorkerCallback(command,event,{isAuthenticatedWorker=false}={}) {
 if(!isAuthenticatedWorker || !command || command.environment!=='DEV'||event?.environment!=='DEV') return {accepted:false,reason:'unauthenticated_or_environment'};
 if(!eq(command.commandId,event.commandId)||!eq(command.nonce,event.nonce)||command.jobId!==event.jobId) return {accepted:false,reason:'correlation_mismatch'};
 if(!event.resultId || !event.callbackId || event.ackSource!=='ai-core-dev-runtime') return {accepted:false,reason:'callback_receipt_missing'};
 return {accepted:true,commandId:command.commandId,callbackId:event.callbackId,resultId:event.resultId,workerAckVerified:true,conversationAckVerified:false};
}
export function conversationDeliveryGate(receipt,pairing){
 if(!receipt?.accepted||!pairing?.trustedIssuerVerified||!pairing?.browserOwnershipVerified||!pairing?.chatSessionIdVerified||!pairing?.conversationId||pairing.environment!=='DEV') return {allowed:false,reason:'trusted_browser_pairing_required'};
 return {allowed:true,conversationId:pairing.conversationId,commandId:receipt.commandId,conversationAckVerified:false};
}
export function verifiedConversationAck(delivery,ack) {
 if(!delivery?.allowed||!ack?.receiverAuthenticated||ack?.source!=='chatgpt-conversation-callback'||!eq(delivery.commandId,ack.commandId)||!eq(delivery.conversationId,ack.conversationId)||!ack?.responseId) return false;
 return true;
}
