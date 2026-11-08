/**
 * Cross-language canonical signing bytes for DEV GPT02 recovery fencing.
 *
 * This module ONLY constructs a validated byte payload. It neither signs nor
 * authorizes, issues, leases, dispatches or closes any command.
 *
 * Native consumer: scripts/windows/ai-core/dev_gpt02_recovery_fence.py
 * A later server signer must independently verify current DB lease/lineage
 * and authorization before using these bytes with a server-custodied key.
 */
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const SHA=/^[0-9a-f]{64}$/;
const WORKER=/^[A-Za-z0-9_.:-]{1,128}$/;
const DOMAIN="ai-core-gpt02-recovery-fence/v1\n";
const PROTOCOL="ai-core-gpt02-recovery-fence/v1";
const names=[
  "protocol","reservationId","parentCommandId","childCommandId",
  "humanReviewId","jobId","workerId","artifactSha256",
  "fencingToken","sequence","issuedAtUtcMs","expiresAtUtcMs",
] as const;
type Name=typeof names[number];
export type Gpt02NativeRecoveryFenceProof=Record<Name,string|number>;

function requireProof(x:unknown): asserts x is Gpt02NativeRecoveryFenceProof {
  if(typeof x!=="object"||x===null||Array.isArray(x))
    throw new Error("GPT02_FENCE_INVALID_PROOF_SHAPE");
  const v=x as Record<string,unknown>;
  if(Object.keys(v).length!==names.length||
    names.some(name=>!Object.prototype.hasOwnProperty.call(v,name)))
    throw new Error("GPT02_FENCE_INVALID_PROOF_KEYS");
  if(v["protocol"]!==PROTOCOL||
    ["reservationId","parentCommandId","childCommandId"].some(k=>
      typeof v[k]!=="string"||!UUID.test(v[k] as string)) ||
    typeof v["artifactSha256"]!=="string"||!SHA.test(v["artifactSha256"])||
    typeof v["workerId"]!=="string"||!WORKER.test(v["workerId"]))
    throw new Error("GPT02_FENCE_INVALID_CONTEXT");
  for(const [name,min,max] of [
    ["humanReviewId",1,2_147_483_647],["jobId",1,2_147_483_647],
    ["fencingToken",1,Number.MAX_SAFE_INTEGER],
    ["sequence",0,Number.MAX_SAFE_INTEGER],
    ["issuedAtUtcMs",1,Number.MAX_SAFE_INTEGER],
    ["expiresAtUtcMs",1,Number.MAX_SAFE_INTEGER],
  ] as const) {
    if(!Number.isSafeInteger(v[name])||!(min<= (v[name] as number) && (v[name] as number)<=max))
      throw new Error("GPT02_FENCE_INVALID_NUMBER_"+name);
  }
  if((v["expiresAtUtcMs"] as number)<=(v["issuedAtUtcMs"] as number)||
    (v["expiresAtUtcMs"] as number)-(v["issuedAtUtcMs"] as number)>120_000)
    throw new Error("GPT02_FENCE_INVALID_LIFETIME");
  // Never round PostgreSQL bigint fencing tokens into unsafe JS numbers.
  // On overflow a future signer MUST fail closed, not approximate identity.
}

export function canonicalGpt02NativeRecoveryFenceProof(x:unknown):Buffer {
  requireProof(x);
  const v=x as unknown as Record<string,unknown>;
  const sorted=Object.fromEntries([...names].sort().map(k=>[k,v[k]]));
  const json=JSON.stringify(sorted);
  const result=Buffer.from(DOMAIN+json,"utf8");
  if(result.length>3_000)
    throw new Error("GPT02_FENCE_CANONICAL_SIZE_EXCEEDED");
  return result;
}
