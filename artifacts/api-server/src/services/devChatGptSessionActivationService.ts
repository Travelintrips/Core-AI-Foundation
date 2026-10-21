import { createHash, createPublicKey, randomBytes, verify as verifySignature } from "node:crypto";
import { devAttestationKeyId, devAssistantPublicKeyForWorker, type DevAttestationWorker } from "./devAssistantAttestation.js";
import { devWakeBindingFingerprint, parseDevWakeAccountBindings, type DevWakeTarget, type DevWakeWorker } from "./devChatGptWakeBindingService.js";

const CHALLENGE_TTL_MS = 2 * 60_000;
const CLOCK_SKEW_MS = 60_000;
const PROFILE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const OWNER = /^ai-engine-oauth:[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

type StoredBindingRow = {
  accountAlias: string;
  ownerChannel: string;
  targetConversationId: string;
  workerId: DevWakeWorker;
  browserProfile: string;
  enabled: boolean;
};
type BindingRegistry = { version: 1; bindings: StoredBindingRow[] };
export type SessionChallenge = {
  challengeId: string;
  nonce: string;
  accountAlias: string;
  ownerChannel: string;
  targetConversationId: string;
  workerId: DevWakeWorker;
  browserProfile: string;
  bindingFingerprint: string;
  expiresAt: number;
  consumed: boolean;
};

const challenges = new Map<string, SessionChallenge>();
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function parseRegistry(raw: string | undefined): BindingRegistry {
  if (!raw?.trim()) throw new Error("DEV_CHATGPT_SESSION_REGISTRY_MISSING");
  const parsed: unknown = JSON.parse(raw);
  if (!record(parsed) || parsed["version"] !== 1 || !Array.isArray(parsed["bindings"])) {
    throw new Error("DEV_CHATGPT_SESSION_REGISTRY_INVALID");
  }
  return {
    version: 1,
    bindings: parsed["bindings"].map((row) => {
      if (!record(row)) throw new Error("DEV_CHATGPT_SESSION_REGISTRY_INVALID");
      return row as unknown as StoredBindingRow;
    }),
  };
}

function fingerprint(row: StoredBindingRow): string {
  return devWakeBindingFingerprint({
    version: 1,
    accountAlias: row.accountAlias,
    ownerChannel: row.ownerChannel,
    targetConversationId: row.targetConversationId,
    workerId: row.workerId,
    browserProfile: row.browserProfile,
  });
}

export function sessionRegistrationPayload(input: {
  challengeId: string;
  nonce: string;
  accountAlias: string;
  ownerChannel: string;
  targetConversationId: string;
  workerId: DevWakeWorker;
  browserProfile: string;
  bindingFingerprint: string;
  observedAt: string;
}): string {
  return [
    "dev-chatgpt-session-registration/v1",
    "challengeId=" + input.challengeId,
    "nonce=" + input.nonce,
    "accountAlias=" + input.accountAlias,
    "ownerChannel=" + input.ownerChannel,
    "targetConversationId=" + input.targetConversationId,
    "workerId=" + input.workerId,
    "browserProfile=" + input.browserProfile,
    "bindingFingerprint=" + input.bindingFingerprint,
    "observedAt=" + input.observedAt,
  ].join("\n");
}
export function issueDevChatGptSessionChallenge(input: {
  rawRegistry: string | undefined;
  bindingFingerprint: string;
  legacyTargets: DevWakeTarget[];
  expectedWorkerId?: string;
  now?: number;
}): SessionChallenge {
  const registry = parseRegistry(input.rawRegistry);
  parseDevWakeAccountBindings(JSON.stringify(registry), input.legacyTargets);
  if (!DIGEST.test(input.bindingFingerprint)) throw new Error("DEV_CHATGPT_SESSION_FINGERPRINT_INVALID");
  const row = registry.bindings.find((candidate) => fingerprint(candidate) === input.bindingFingerprint);
  if (!row) throw new Error("DEV_CHATGPT_SESSION_BINDING_NOT_FOUND");
  if (!/^GPT[0-9]{2,4}$/.test(row.accountAlias) || row.accountAlias === "GPT01" ||
      !OWNER.test(row.ownerChannel) || !UUID.test(row.targetConversationId) || !PROFILE.test(row.browserProfile)) {
    throw new Error("DEV_CHATGPT_SESSION_BINDING_INVALID");
  }
  if (input.expectedWorkerId !== undefined && input.expectedWorkerId !== row.workerId) {
    throw new Error("DEV_CHATGPT_SESSION_WORKER_MISMATCH");
  }
  if (!devAssistantPublicKeyForWorker(row.workerId)) {
    throw new Error("DEV_CHATGPT_SESSION_WORKER_UNTRUSTED");
  }
  const now = input.now ?? Date.now();
  const challenge: SessionChallenge = {
    challengeId: randomBytes(16).toString("hex"),
    nonce: randomBytes(32).toString("base64url"),
    accountAlias: row.accountAlias,
    ownerChannel: row.ownerChannel,
    targetConversationId: row.targetConversationId,
    workerId: row.workerId,
    browserProfile: row.browserProfile,
    bindingFingerprint: input.bindingFingerprint,
    expiresAt: now + CHALLENGE_TTL_MS,
    consumed: false,
  };
  challenges.set(challenge.challengeId, challenge);
  return { ...challenge };
}
export function verifyAndConsumeDevChatGptSessionChallenge(input: {
  challengeId: string;
  nonce: string;
  observedAt: string;
  signature: string;
  keyId: string;
  expectedWorkerId?: string;
  now?: number;
}): SessionChallenge {
  const challenge = challenges.get(input.challengeId);
  if (!challenge || challenge.consumed) throw new Error("DEV_CHATGPT_SESSION_CHALLENGE_INVALID");
  if (input.expectedWorkerId !== undefined && input.expectedWorkerId !== challenge.workerId) {
    throw new Error("DEV_CHATGPT_SESSION_WORKER_MISMATCH");
  }
  const now = input.now ?? Date.now();
  if (challenge.expiresAt <= now || input.nonce !== challenge.nonce) {
    challenges.delete(input.challengeId);
    throw new Error("DEV_CHATGPT_SESSION_CHALLENGE_INVALID");
  }
  if (!ISO.test(input.observedAt)) throw new Error("DEV_CHATGPT_SESSION_TIME_INVALID");
  const observed = Date.parse(input.observedAt);
  if (!Number.isFinite(observed) ||
      observed < now - CHALLENGE_TTL_MS - CLOCK_SKEW_MS ||
      observed > now + CLOCK_SKEW_MS) {
    throw new Error("DEV_CHATGPT_SESSION_TIME_INVALID");
  }

  const worker = challenge.workerId as DevAttestationWorker;
  if (input.keyId !== devAttestationKeyId(worker)) {
    throw new Error("DEV_CHATGPT_SESSION_KEY_ID_INVALID");
  }
  const publicKeyDerBase64 = devAssistantPublicKeyForWorker(worker);
  if (!publicKeyDerBase64) throw new Error("DEV_CHATGPT_SESSION_WORKER_UNTRUSTED");

  let signature: Buffer;
  let publicKey: ReturnType<typeof createPublicKey>;
  try {
    signature = Buffer.from(input.signature, "base64");
    if (signature.length !== 64 || signature.toString("base64") !== input.signature) {
      throw new Error("signature");
    }
    const keyBytes = Buffer.from(publicKeyDerBase64, "base64");
    if (keyBytes.length < 32 || keyBytes.toString("base64") !== publicKeyDerBase64) {
      throw new Error("public-key");
    }
    publicKey = createPublicKey({ key: keyBytes, format: "der", type: "spki" });
  } catch {
    throw new Error("DEV_CHATGPT_SESSION_CRYPTO_INVALID");
  }

  const payload = sessionRegistrationPayload({ ...challenge, observedAt: input.observedAt });
  if (!verifySignature(null, Buffer.from(payload, "utf8"), publicKey, signature)) {
    throw new Error("DEV_CHATGPT_SESSION_SIGNATURE_INVALID");
  }
  challenge.consumed = true;
  challenges.set(challenge.challengeId, challenge);
  return { ...challenge };
}
export function activateDevChatGptSessionBinding(input: {
  rawRegistry: string | undefined;
  bindingFingerprint: string;
  legacyTargets: DevWakeTarget[];
}): { registryJson: string; binding: StoredBindingRow } {
  const registry = parseRegistry(input.rawRegistry);
  const index = registry.bindings.findIndex((row) => fingerprint(row) === input.bindingFingerprint);
  if (index < 0) throw new Error("DEV_CHATGPT_SESSION_BINDING_NOT_FOUND");
  const row = registry.bindings[index]!;
  const next: BindingRegistry = {
    version: 1,
    bindings: registry.bindings.map((candidate, candidateIndex) =>
      candidateIndex === index ? { ...candidate, enabled: true } : candidate),
  };
  parseDevWakeAccountBindings(JSON.stringify(next), input.legacyTargets);
  return { registryJson: JSON.stringify(next), binding: { ...row, enabled: true } };
}

export function sessionRegistrationReceiptFingerprint(input: {
  bindingFingerprint: string;
  signature: string;
}): string {
  return createHash("sha256")
    .update(input.bindingFingerprint + "|" + input.signature)
    .digest("hex");
}
