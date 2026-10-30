import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  activateDevChatGptSessionBinding,
  issueDevChatGptSessionChallenge,
  sessionRegistrationPayload,
  verifyAndConsumeDevChatGptSessionChallenge,
} from "../devChatGptSessionActivationService.js";
import { DEV_WAKE_DELL_WORKER, devWakeBindingFingerprint } from "../devChatGptWakeBindingService.js";
import { DEV_DELL_ASSISTANT_ATTESTATION_KEY_ID } from "../devAssistantAttestation.js";

const ownerChannel = "ai-engine-oauth:" + "2".repeat(64);
const targetConversationId = "22222222-2222-4222-8222-222222222222";
const row = {
  accountAlias: "GPT02",
  ownerChannel,
  targetConversationId,
  workerId: DEV_WAKE_DELL_WORKER,
  browserProfile: "admcst001-dev",
  enabled: false,
};
const fingerprint = devWakeBindingFingerprint({ version: 1, ...row });
const registry = JSON.stringify({ version: 1, bindings: [row] });
const legacy = [{
  ownerChannel: "ai-engine-oauth:" + "1".repeat(64),
  targetConversationId: "11111111-1111-4111-8111-111111111111",
  workerId: DEV_WAKE_DELL_WORKER,
}];

afterEach(() => vi.unstubAllEnvs());

describe("DEV ChatGPT session activation", () => {
  it("requires a trusted Ed25519 worker proof before enabling a staged session", () => {
    const pair = generateKeyPairSync("ed25519");
    vi.stubEnv("AI_CORE_DEV_DELL_ASSISTANT_ATTESTATION_PUBLIC_KEY_DER_B64",
      pair.publicKey.export({ format: "der", type: "spki" }).toString("base64"));
    const now = Date.parse("2026-10-22T01:00:00.000Z");
    const challenge = issueDevChatGptSessionChallenge({
      rawRegistry: registry,
      bindingFingerprint: fingerprint,
      legacyTargets: legacy,
      now,
    });
    const observedAt = "2026-10-22T01:00:01.000Z";
    const payload = sessionRegistrationPayload({ ...challenge, observedAt });
    const signature = sign(null, Buffer.from(payload, "utf8"), pair.privateKey).toString("base64");

    const verified = verifyAndConsumeDevChatGptSessionChallenge({
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      observedAt,
      signature,
      keyId: DEV_DELL_ASSISTANT_ATTESTATION_KEY_ID,
      now: now + 1_000,
    });
    expect(verified.bindingFingerprint).toBe(fingerprint);

    const active = activateDevChatGptSessionBinding({
      rawRegistry: registry,
      bindingFingerprint: fingerprint,
      legacyTargets: legacy,
    });
    expect(active.binding.enabled).toBe(true);
    expect(JSON.parse(active.registryJson).bindings[0].enabled).toBe(true);
  });

  it("does not issue or consume a challenge for the wrong authenticated worker", () => {
    const pair = generateKeyPairSync("ed25519");
    vi.stubEnv("AI_CORE_DEV_DELL_ASSISTANT_ATTESTATION_PUBLIC_KEY_DER_B64",
      pair.publicKey.export({ format: "der", type: "spki" }).toString("base64"));
    const now = Date.parse("2026-10-22T01:00:00.000Z");

    expect(() => issueDevChatGptSessionChallenge({
      rawRegistry: registry,
      bindingFingerprint: fingerprint,
      legacyTargets: legacy,
      expectedWorkerId: "openclaw-travelintrips-dev",
      now,
    })).toThrow("DEV_CHATGPT_SESSION_WORKER_MISMATCH");

    const challenge = issueDevChatGptSessionChallenge({
      rawRegistry: registry,
      bindingFingerprint: fingerprint,
      legacyTargets: legacy,
      expectedWorkerId: DEV_WAKE_DELL_WORKER,
      now,
    });
    const observedAt = "2026-10-22T01:00:01.000Z";
    const signature = sign(null,
      Buffer.from(sessionRegistrationPayload({ ...challenge, observedAt }), "utf8"),
      pair.privateKey).toString("base64");

    expect(() => verifyAndConsumeDevChatGptSessionChallenge({
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      observedAt,
      signature,
      keyId: DEV_DELL_ASSISTANT_ATTESTATION_KEY_ID,
      expectedWorkerId: "openclaw-travelintrips-dev",
      now: now + 1_000,
    })).toThrow("DEV_CHATGPT_SESSION_WORKER_MISMATCH");

    expect(verifyAndConsumeDevChatGptSessionChallenge({
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      observedAt,
      signature,
      keyId: DEV_DELL_ASSISTANT_ATTESTATION_KEY_ID,
      expectedWorkerId: DEV_WAKE_DELL_WORKER,
      now: now + 1_000,
    }).workerId).toBe(DEV_WAKE_DELL_WORKER);
  });

  it("rejects a forged signature and never consumes it as valid proof", () => {
    const trusted = generateKeyPairSync("ed25519");
    const attacker = generateKeyPairSync("ed25519");
    vi.stubEnv("AI_CORE_DEV_DELL_ASSISTANT_ATTESTATION_PUBLIC_KEY_DER_B64",
      trusted.publicKey.export({ format: "der", type: "spki" }).toString("base64"));
    const now = Date.parse("2026-10-22T01:00:00.000Z");
    const challenge = issueDevChatGptSessionChallenge({
      rawRegistry: registry,
      bindingFingerprint: fingerprint,
      legacyTargets: legacy,
      now,
    });
    const observedAt = "2026-10-22T01:00:01.000Z";
    const signature = sign(null,
      Buffer.from(sessionRegistrationPayload({ ...challenge, observedAt }), "utf8"),
      attacker.privateKey).toString("base64");
    expect(() => verifyAndConsumeDevChatGptSessionChallenge({
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      observedAt,
      signature,
      keyId: DEV_DELL_ASSISTANT_ATTESTATION_KEY_ID,
      now: now + 1_000,
    })).toThrow("DEV_CHATGPT_SESSION_SIGNATURE_INVALID");
  });
});
