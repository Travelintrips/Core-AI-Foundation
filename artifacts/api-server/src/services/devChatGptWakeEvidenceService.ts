import { deriveDevAssistantChallenge, verifyDevAssistantAttestation, type DevAttestationWorker } from "./devAssistantAttestation.js";
import { commandMatchesDevWakeTarget, readDevWakeBinding, type DevWakeTarget } from "./devChatGptWakeBindingService.js";

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Build expectations only from the persisted, claimed command, never the callback. */
export function devWakeAttestationExpected(metadata: unknown): Parameters<typeof verifyDevAssistantAttestation>[0]["expected"] | null {
  if (!record(metadata)) return null;
  const worker = metadata["assignedClientId"];
  if (worker !== "openclaw-travelintrips-dev" && worker !== "openclaw-dell-chatgpt-wake-dev" &&
      worker !== "openclaw-gpt02-session-dev") return null;
  const ownerChannel = metadata["conversationId"];
  const targetConversationId = metadata["targetConversationId"];
  const eventId = metadata["eventId"];
  if (typeof ownerChannel !== "string" || typeof targetConversationId !== "string" || typeof eventId !== "string") return null;
  const wakeBinding = readDevWakeBinding(metadata["wakeBinding"]);
  if (metadata["wakeBinding"] !== undefined && !wakeBinding) return null;
  const target: DevWakeTarget = { ownerChannel, targetConversationId, workerId: worker, ...(wakeBinding ? { wakeBinding } : {}) };
  if (!commandMatchesDevWakeTarget(metadata, target) ||
      (wakeBinding && (wakeBinding.ownerChannel !== ownerChannel || wakeBinding.targetConversationId !== targetConversationId || wakeBinding.workerId !== worker))) return null;
  const continuity = metadata["devContinuity"];
  if (continuity !== undefined && !record(continuity)) return null;
  // The worker hashes the top-level context. Callback, retry and restore must
  // reject a second, divergent representation before trusting either one.
  if (record(continuity)) {
    if (metadata["watchCommandId"] === undefined || metadata["jobId"] === undefined || metadata["checkpointRevision"] === undefined ||
        continuity["ownerChannel"] !== ownerChannel || continuity["eventId"] !== eventId ||
        continuity["parentWatchCommandId"] !== metadata["watchCommandId"] ||
        continuity["jobId"] !== metadata["jobId"] ||
        continuity["checkpointRevision"] !== metadata["checkpointRevision"] ||
        continuity["assistantAttestationChallenge"] !== metadata["assistantAttestationChallenge"]) return null;
  } else if (["watchCommandId", "jobId", "checkpointRevision"].some(key => metadata[key] !== undefined)) return null;
  const expected = {
    ownerChannel, targetConversationId, eventId, workerId: worker as DevAttestationWorker,
    ...(record(continuity) ? { watchCommandId: continuity["parentWatchCommandId"] as string,
      jobId: continuity["jobId"] as string, checkpointRevision: continuity["checkpointRevision"] as number } : {}),
    ...(wakeBinding ? { bindingFingerprint: wakeBinding.bindingFingerprint, browserProfile: wakeBinding.browserProfile } : {}),
  };
  try {
    return deriveDevAssistantChallenge(expected) === metadata["assistantAttestationChallenge"] ? expected : null;
  } catch { return null; }
}

export function verifyDevWakeCommandReceipt(input: {
  metadata: unknown;
  details: Record<string, unknown>;
  notBefore: string;
  receivedAt: string;
  publicKeyDerBase64?: string;
}): ReturnType<typeof verifyDevAssistantAttestation> {
  const expected = devWakeAttestationExpected(input.metadata);
  if (!expected) return { verified: false, reason: "ATTESTATION_COMMAND_BINDING_INVALID" };
  if (input.details["conversationId"] !== expected.targetConversationId || input.details["eventId"] !== expected.eventId ||
      input.details["browserConfirmed"] !== true || input.details["browserPairingVerified"] !== true ||
      input.details["chatgptSubmitted"] !== true || input.details["verifiedAssistantReply"] !== true || input.details["exitCode"] !== 0) {
    return { verified: false, reason: "ATTESTATION_BROWSER_RECEIPT_INVALID" };
  }
  return verifyDevAssistantAttestation({ ...input, expected });
}
