import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

export type DevSopCheckpointReceipt = {
  version: 1;
  jobId: string;
  commandId: string;
  correlationId: string;
  checkpointId: string;
  sopVersion: string;
  nextStepId: string;
  issuedAt: string;
  signature: string;
};

const identifier = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;
const digest = /^[a-f0-9]{64}$/;

export function parseDevSopCheckpointIntent(message: string): Record<string, unknown> | null {
  if (message.length > 4096 || !message.startsWith("{")) return null;
  try {
    const json: unknown = JSON.parse(message);
    if (!json || typeof json !== "object" || Array.isArray(json)) return null;
    const data = json as Record<string, unknown>;
    return data.kind === "SOP_CHECKPOINT" && data.status === "PAUSED" ? data : null;
  } catch {
    return null;
  }
}

export function issueVerifiedDevSopCheckpoint(input: {
  message: string;
  intent: Record<string, unknown>;
  verifiedAssistantReceipt: boolean;
  assistantResponseHash: unknown;
  commandId: string;
  correlationId: string;
  privateKeyPkcs8DerBase64?: string;
  issuedAt?: string;
}): DevSopCheckpointReceipt {
  if (!input.verifiedAssistantReceipt || !digest.test(String(input.assistantResponseHash ?? "")) ||
      createHash("sha256").update(input.message, "utf8").digest("hex") !== input.assistantResponseHash) {
    throw new Error("DEV_SOP_CHECKPOINT_ASSISTANT_EVIDENCE_UNVERIFIED");
  }
  const data = input.intent;
  if (data.commandId !== input.commandId || data.correlationId !== input.correlationId ||
      ![data.jobId, data.checkpointId, data.sopVersion, data.nextStepId, input.commandId, input.correlationId]
        .every((x) => typeof x === "string" && identifier.test(x))) {
    throw new Error("DEV_SOP_CHECKPOINT_IDENTITY_MISMATCH");
  }
  if (!input.privateKeyPkcs8DerBase64) throw new Error("DEV_SOP_CHECKPOINT_PRIVATE_KEY_NOT_CONFIGURED");
  const issuedAt = input.issuedAt ?? new Date().toISOString();
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(issuedAt)) {
    throw new Error("DEV_SOP_CHECKPOINT_TIME_INVALID");
  }
  const unsigned = {
    version: 1 as const,
    jobId: data.jobId as string, commandId: input.commandId,
    correlationId: input.correlationId, checkpointId: data.checkpointId as string,
    sopVersion: data.sopVersion as string, nextStepId: data.nextStepId as string, issuedAt,
  };
  const payload = ["ai-core-dev-checkpoint/v1", unsigned.jobId, unsigned.commandId,
    unsigned.correlationId, unsigned.checkpointId, unsigned.sopVersion,
    unsigned.nextStepId, unsigned.issuedAt].join("\n");
  try {
    const keyBytes = Buffer.from(input.privateKeyPkcs8DerBase64, "base64");
    if (keyBytes.toString("base64") !== input.privateKeyPkcs8DerBase64) throw new Error("invalid encoding");
    const key = createPrivateKey({ key: keyBytes, format: "der", type: "pkcs8" });
    if (key.asymmetricKeyType !== "ed25519") throw new Error("invalid key");
    return { ...unsigned, signature: sign(null, Buffer.from(payload, "utf8"), key).toString("base64") };
  } catch {
    throw new Error("DEV_SOP_CHECKPOINT_SIGNING_KEY_INVALID");
  }
}

/** Strictly validate a server-issued checkpoint without accepting worker self-attestation.
 * Derive the public key from the configured issuer private key; never return key material.
 */
export function verifyDevSopCheckpointReceipt(input: {
  receipt: unknown;
  responseMetadata: unknown;
  checkpoint: unknown;
  commandId: string;
  issuerPrivateKeyDerBase64?: string;
}): boolean {
  try {
    const receipt = input.receipt;
    const metadata = input.responseMetadata;
    const checkpoint = input.checkpoint;
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt) ||
        !metadata || typeof metadata !== "object" || Array.isArray(metadata) ||
        !checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) return false;
    const r = receipt as Record<string, unknown>;
    const m = metadata as Record<string, unknown>;
    const cp = checkpoint as Record<string, unknown>;
    if (r.version !== 1 || r.commandId !== input.commandId ||
        m["verified"] !== true || m["checkpointVerified"] !== true ||
        m["verifiedAssistantReply"] !== true) return false;
    const fields = ["jobId", "commandId", "correlationId", "checkpointId", "sopVersion", "nextStepId"] as const;
    if (!fields.every(key => typeof r[key] === "string" && identifier.test(r[key] as string))) return false;
    if (!fields.filter(k => ["jobId", "checkpointId", "sopVersion", "nextStepId"].includes(k))
      .every(key => cp[key] === r[key])) return false;
    if (m["jobId"] !== r.jobId || m["sopVersion"] !== r.sopVersion) return false;
    if (typeof r.issuedAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.issuedAt) ||
        !Number.isFinite(Date.parse(r.issuedAt))) return false;
    if (typeof r.signature !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(r.signature)) return false;
    const attestation = m["attestation"];
    if (!attestation || typeof attestation !== "object" || Array.isArray(attestation)) return false;
    const a = attestation as Record<string, unknown>;
    if (a.algorithm !== "Ed25519" || a.signature !== r.signature) return false;
    if (!input.issuerPrivateKeyDerBase64) return false;
    const bytes = Buffer.from(input.issuerPrivateKeyDerBase64, "base64");
    if (bytes.toString("base64") !== input.issuerPrivateKeyDerBase64) return false;
    const privateKey = createPrivateKey({ key: bytes, format: "der", type: "pkcs8" });
    if (privateKey.asymmetricKeyType !== "ed25519") return false;
    const payload = ["ai-core-dev-checkpoint/v1", r.jobId, r.commandId,
      r.correlationId, r.checkpointId, r.sopVersion, r.nextStepId, r.issuedAt].join("\n");
    const sig = Buffer.from(r.signature, "base64");
    return sig.length === 64 && verify(null, Buffer.from(payload, "utf8"), createPublicKey(privateKey), sig);
  } catch { return false; }
}
