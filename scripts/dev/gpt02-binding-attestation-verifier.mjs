/** Offline independent evidence verifier prototype. NEVER an authorization oracle.
 * Caller cannot choose verification key or claim 'verified' by setting a flag.
 * The separate verifier/key custody and nonce ledger are NOT deployed.
 */
import {createPublicKey,verify as verifySignature} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[0-9a-f]{64}$/;
const KEYS=['attestationVersion','commandId','receiverJobId','attemptId',
 'tenantId','evidenceSha256','operatorUserId','issuedAt','expiresAt','nonce'];
const allowed=x=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join('|')===KEYS.slice().sort().join('|');
function deny(reason){return {signatureValid:false,reason,independentAttestationVerified:false,
 mayPersistBinding:false,mayIssueGrant:false,mayDispatchWorker:false,mayCloseJob:false,
 releaseDecision:'NO_GO'};}
export function verifyOfflineBindingAttestation(input,expected){
 const payload=input?.payload;
 if(!allowed(payload))return deny('NON_CANONICAL_PAYLOAD');
 if(payload.attestationVersion!==1||payload.tenantId!=='default'||
  ![payload.commandId,payload.receiverJobId,payload.attemptId,payload.nonce].every(x=>typeof x==='string'&&UUID.test(x))||
  !HASH.test(payload.evidenceSha256)||!Number.isSafeInteger(payload.operatorUserId)||payload.operatorUserId<=0)
  return deny('INVALID_BOUND_IDENTITIES');
 if(!expected||payload.commandId!==expected.commandId||
  payload.receiverJobId!==expected.receiverJobId||
  payload.attemptId!==expected.attemptId||
  payload.evidenceSha256!==expected.evidenceSha256||
  payload.operatorUserId!==expected.operatorUserId)return deny('CONTEXT_MISMATCH');
 const now=expected.now;
 const issued=Date.parse(payload.issuedAt),expires=Date.parse(payload.expiresAt);
 if(!Number.isFinite(now)||!Number.isFinite(issued)||!Number.isFinite(expires)||
  issued>now+5000||issued<now-120000||expires<=now||expires<=issued||expires-issued>120000)
  return deny('EXPIRED_OR_INVALID_WINDOW');
 if(expected.nonceUnused!==true)return deny('NONCE_NOT_INDEPENDENTLY_VERIFIED');
 if(typeof input.signatureBase64!=='string'||typeof expected.trustedPublicKeyDerBase64!=='string')
  return deny('MISSING_TRUSTED_SIGNATURE');
 try{
  const spki=Buffer.from(expected.trustedPublicKeyDerBase64,'base64');
  const key=createPublicKey({key:spki,format:'der',type:'spki'});
  if(key.asymmetricKeyType!=='ed25519')return deny('WRONG_KEY_TYPE');
  const sig=Buffer.from(input.signatureBase64,'base64');
  if(sig.length!==64)return deny('BAD_SIGNATURE');
  const raw=Buffer.from(JSON.stringify(KEYS.map(k=>payload[k])));
  if(!verifySignature(null,raw,key,sig))return deny('BAD_SIGNATURE');
  // A valid test signature is only an observation. There is still no DB-bound
  // verifier/role/nonce reservation or scoped writer service in the runtime.
  return {...deny('VALID_SIGNATURE_BUT_NO_INDEPENDENT_RUNTIME_ATTESTOR'),signatureValid:true};
 }catch{return deny('INVALID_KEY_OR_SIGNATURE_ENCODING');}
}
export const attestationCanonicalBytes=payload=>Buffer.from(JSON.stringify(KEYS.map(k=>payload[k])));
