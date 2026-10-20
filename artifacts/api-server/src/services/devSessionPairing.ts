import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * A fail-closed pairing primitive. Neither an OAuth session nor a client-supplied
 * conversation ID is proof that the caller owns a ChatGPT browser conversation.
 * A trusted, authenticated browser adapter must supply an independently verified
 * observation before any binding may be created.
 *
 * This module does not create an attestation authority or expose an MCP route.
 */
export type VerifiedBrowserObservation = {
  observedConversationId: string;
  browserAgentId: string;
  observedOrigin: string;
  verifiedByTrustedAdapter: true;
};

type Pending = {
  oauthSubject: string;
  digest: Buffer;
  expiresAt: number;
  used: boolean;
};

export class DevSessionPairing {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = 120_000,
  ) {
    if (!Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > 300_000) {
      throw new Error("Invalid pairing TTL");
    }
  }

  issue(oauthSubject: string): { pairingId: string; challenge: string; expiresAt: number } {
    if (!oauthSubject.trim()) throw new Error("Authenticated OAuth subject required");
    const pairingId = randomBytes(16).toString("hex");
    const challenge = randomBytes(32).toString("base64url");
    const expiresAt = this.now() + this.ttlMs;
    this.pending.set(pairingId, {
      oauthSubject,
      digest: createHash("sha256").update(challenge).digest(),
      expiresAt,
      used: false,
    });
    return { pairingId, challenge, expiresAt };
  }

  verify(
    pairingId: string,
    challenge: string,
    oauthSubject: string,
    observation: VerifiedBrowserObservation,
  ): { bound: true; conversationId: string; browserAgentId: string } | { bound: false } {
    const entry = this.pending.get(pairingId);
    if (!entry || entry.used || this.now() >= entry.expiresAt) return { bound: false };
    // Burn the challenge on *any* attempt, to prevent guessing and replay.
    entry.used = true;
    if (entry.oauthSubject !== oauthSubject) return { bound: false };
    if (observation.verifiedByTrustedAdapter !== true) return { bound: false };
    if (observation.observedOrigin !== "https://chatgpt.com") return { bound: false };
    if (!/^[-a-zA-Z0-9]{8,200}$/.test(observation.observedConversationId)) return { bound: false };
    if (!observation.browserAgentId.trim()) return { bound: false };
    const actual = createHash("sha256").update(challenge).digest();
    if (!timingSafeEqual(entry.digest, actual)) return { bound: false };
    return {
      bound: true,
      conversationId: observation.observedConversationId,
      browserAgentId: observation.browserAgentId,
    };
  }
}
