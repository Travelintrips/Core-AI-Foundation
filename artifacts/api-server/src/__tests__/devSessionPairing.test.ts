import { describe, expect, it } from "vitest";
import { DevSessionPairing } from "../services/devSessionPairing.js";

const proof = {
  observedConversationId: "6ad35eba-25bc-83ec-9c92-e07df188c0d3",
  browserAgentId: "openclaw-travelintrips",
  observedOrigin: "https://chatgpt.com",
  verifiedByTrustedAdapter: true as const,
};

describe("DEV session pairing primitive", () => {
  it("accepts an exact, fresh, authenticated proof once", () => {
    const registry = new DevSessionPairing();
    const pair = registry.issue("oauth:alice");
    expect(registry.verify(pair.pairingId, pair.challenge, "oauth:alice", proof)).toEqual({
      bound: true,
      conversationId: proof.observedConversationId,
      browserAgentId: proof.browserAgentId,
    });
    expect(registry.verify(pair.pairingId, pair.challenge, "oauth:alice", proof)).toEqual({ bound: false });
  });

  it("rejects subject mismatch, invalid origin, and untrusted assertions", () => {
    for (const [subject, observation] of [
      ["oauth:bob", proof],
      ["oauth:alice", { ...proof, observedOrigin: "https://example.com" }],
      ["oauth:alice", { ...proof, verifiedByTrustedAdapter: false }],
    ] as const) {
      const registry = new DevSessionPairing();
      const pair = registry.issue("oauth:alice");
      expect(registry.verify(pair.pairingId, pair.challenge, subject, observation)).toEqual({ bound: false });
    }
  });

  it("expires and rejects incorrect challenges", () => {
    let now = 1000;
    const registry = new DevSessionPairing(() => now, 100);
    const expired = registry.issue("oauth:alice");
    now = 1100;
    expect(registry.verify(expired.pairingId, expired.challenge, "oauth:alice", proof)).toEqual({ bound: false });
    const pair = registry.issue("oauth:alice");
    expect(registry.verify(pair.pairingId, "incorrect", "oauth:alice", proof)).toEqual({ bound: false });
    expect(registry.verify(pair.pairingId, pair.challenge, "oauth:alice", proof)).toEqual({ bound: false });
  });
});
