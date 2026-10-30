import { createHash, createPrivateKey, sign } from "node:crypto";

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
