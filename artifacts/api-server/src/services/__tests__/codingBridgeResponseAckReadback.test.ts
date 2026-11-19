import { describe, expect, it } from "vitest";
import { toCodingBridgeAckReadback } from "../codingBridgeResponseAckReadback.js";

const id = "11111111-1111-4111-8111-111111111111";
const commandId = "22222222-2222-4222-8222-222222222222";
const record = {
  id,
  commandId,
  kind: "COMPLETED",
  acknowledgedAt: new Date("2026-11-06T00:00:00.000Z"),
  metadataJson: {
    e2eCode: "E2E_VERIFIED",
    deliveryCode: "DELIVERY_CONFIRMED",
    verifiedAssistantReply: true,
    browserPairingVerified: true,
    assistantResponseText: "DO_NOT_LEAK",
    claimToken: "DO_NOT_LEAK",
  },
};

describe("GPT02 DEV exact response ACK GET read-back projection", () => {
  it("returns the exact persisted response identifiers and ACK timestamp", () => {
    expect(toCodingBridgeAckReadback(record)).toEqual({
      id, commandId, kind: "COMPLETED",
      acknowledgedAt: "2026-11-06T00:00:00.000Z",
      e2eCode: "E2E_VERIFIED", deliveryCode: "DELIVERY_CONFIRMED",
      verifiedAssistantReply: true, browserPairingVerified: true,
    });
  });
  it("does not treat an unacknowledged row as confirmed", () => {
    expect(toCodingBridgeAckReadback({...record, acknowledgedAt: null}).acknowledgedAt).toBeNull();
  });
  it("rejects an invalid persisted Date", () => {
    expect(toCodingBridgeAckReadback({...record, acknowledgedAt: new Date("bad")}).acknowledgedAt).toBeNull();
  });
  it("rejects malformed metadata", () => {
    const x = toCodingBridgeAckReadback({...record, metadataJson: null});
    expect(x.e2eCode).toBeNull();
    expect(x.deliveryCode).toBeNull();
    expect(x.verifiedAssistantReply).toBe(false);
    expect(x.browserPairingVerified).toBe(false);
  });
  it("rejects arrays as metadata", () => {
    expect(toCodingBridgeAckReadback({...record, metadataJson: ["E2E_VERIFIED"]}).e2eCode).toBeNull();
  });
  it("does not trust truthy or stringified verification booleans", () => {
    const x = toCodingBridgeAckReadback({...record, metadataJson: {
      verifiedAssistantReply: "true", browserPairingVerified: 1,
    }});
    expect(x.verifiedAssistantReply).toBe(false);
    expect(x.browserPairingVerified).toBe(false);
  });
  it("does not promote unknown official codes", () => {
    const x = toCodingBridgeAckReadback({...record, metadataJson: {
      e2eCode: "UNKNOWN_UNVERIFIED", deliveryCode: "DELIVERY_SUBMITTED",
    }});
    expect(x.e2eCode).toBeNull();expect(x.deliveryCode).toBeNull();
  });
  it("returns only the allowlisted fields, not messages or credentials", () => {
    const raw = JSON.stringify(toCodingBridgeAckReadback(record));
    expect(raw).not.toContain("DO_NOT_LEAK");
    expect(raw).not.toContain("assistantResponseText");
    expect(raw).not.toContain("claimToken");
    expect(Object.keys(toCodingBridgeAckReadback(record))).toHaveLength(8);
  });
  it("does not confuse an ACK event with a COMPLETED response", () => {
    const x = toCodingBridgeAckReadback({...record, kind: "ACK"});
    expect(x.kind).toBe("ACK");
    expect(x.kind).not.toBe("COMPLETED");
  });
  it("does not mutate the persisted metadata input", () => {
    const original = structuredClone(record.metadataJson);
    toCodingBridgeAckReadback(record);
    expect(record.metadataJson).toEqual(original);
  });
});
