// DEV-only session binding store: only a trusted platform verifier may attest ownership.
// This does not itself grant any OpenAI/ChatGPT session privileges.
import {randomBytes, createHash, timingSafeEqual} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export class SessionBindingCoordinator {
 constructor({store,verifyPlatformAttestation,clock=Date.now}) {
  if(typeof verifyPlatformAttestation!=='function') throw Error('trusted verifier is required');
  this.store=store;this.verifyPlatformAttestation=verifyPlatformAttestation;this.clock=clock;
 }
 async challenge({oauthPrincipal,conversationId,environment='DEV'}) {
  if(environment!=='DEV'||!oauthPrincipal||!conversationId||conversationId.length>200) throw Error('invalid DEV binding request');
  const nonce=randomBytes(32).toString('base64url'),bindingId=randomBytes(16).toString('hex');
  await this.store.put(bindingId,{environment,oauthPrincipal,conversationId,nonceHash:hash(nonce),expiresAt:this.clock()+120000,consumed:false,verified:false});
  return {bindingId,nonce,expiresInSeconds:120,verified:false};
 }
 async attest({bindingId,nonce,attestation}) {
  const row=await this.store.get(bindingId);
  if(!row||row.environment!=='DEV'||row.consumed||row.expiresAt<=this.clock()||!equal(row.nonceHash,hash(nonce))) return {verified:false,reason:'challenge_invalid'};
  // Verifier MUST independently validate issuer signature, audience, expiry, browser ownership
  // and conversation identity. A browser URL, screenshot, OpenClaw statement, or client booleans are insufficient.
  const proof=await this.verifyPlatformAttestation(attestation,{oauthPrincipal:row.oauthPrincipal,conversationId:row.conversationId,nonce});
  if(!proof || proof.issuerVerified!==true||proof.audienceVerified!==true||proof.browserOwnershipVerified!==true||proof.conversationVerified!==true) return {verified:false,reason:'platform_attestation_unverified'};
  const updated={...row,consumed:true,verified:true,verifiedAt:this.clock(),platformReceiptId:proof.receiptId};
  const changed=await this.store.compareAndSet(bindingId,row,updated);
  return changed ? {verified:true,conversationId:row.conversationId,receiptId:proof.receiptId} : {verified:false,reason:'challenge_already_consumed'};
 }
}
