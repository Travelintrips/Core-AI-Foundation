import { describe, expect, it } from "vitest";
import { DevBridgePairingAdapter, DevBridgeVerifiedResultAdapter, type DevBridgeEvidenceReader } from "../services/aiCoreDevBridgeEvidenceAdapters.js";
import { cyclicHandshakeSchema, cyclicResultSchema } from "../services/aiCoreCyclicHandshakeProtocolService.js";

const job = {
  id: "j1", source: "OPENCLAW", source_session_id: "android-dev:zfold4-paired-dev-20",
  status: "COMPLETED", callback_received_at: "2026-10-16T06:04:54Z",
  result_verified_at: "2026-10-16T06:04:55Z",
};
const events = [
  { kind: "RESULT_RECORDED", event_id: "result-proof", sender: "openclaw-android-auto-consumer-dev" },
  { kind: "CALLBACK_ACK", event_id: "ack-proof", sender: "android-dev-database-verifier" },
];
const handshake = cyclicHandshakeSchema.parse({
  protocol: "ai-core-cycle/dev-v1", session_id: "s1", job_id: "j1",
  event_id: "h1", at: "2026-10-16T12:00:00+07:00",
  device_id: "zfold4-paired-dev-20", environment: "DEV", last_ack_event_id: null,
});
const result = cyclicResultSchema.parse({
  protocol: "ai-core-cycle/dev-v1", session_id: "s1", job_id: "j1",
  event_id: "r1", device_id: "zfold4-paired-dev-20",
  environment: "DEV", receipt_status: "VERIFIED",
  callback_verified: true, ack_verified: true,
  evidence_refs: ["result-proof", "ack-proof"],
});
const reader = (changes: Partial<{
  paired: boolean; job: typeof job; events: typeof events;
}> = {}): DevBridgeEvidenceReader => ({
  getJob: async () => changes.job ?? job,
  getJobEvents: async () => changes.events ?? events,
  isCurrentlyPaired: async () => changes.paired ?? true,
});
describe("DEV bridge evidence adapters", () => {
  it("accepts fresh pairing and job ownership", async () => {
    expect(await new DevBridgePairingAdapter(reader()).isAuthorized(handshake)).toBe(true);
  });
  it("rejects unpaired or wrong job ownership", async () => {
    expect(await new DevBridgePairingAdapter(reader({ paired: false })).isAuthorized(handshake)).toBe(false);
    expect(await new DevBridgePairingAdapter(reader({ job: { ...job, source_session_id: "android-dev:other" } })).isAuthorized(handshake)).toBe(false);
  });
  it("accepts verified database evidence and exactly one ACK", async () => {
    expect(await new DevBridgeVerifiedResultAdapter(reader()).verify(result)).toBe(true);
  });
  it("rejects duplicate ACK, incomplete verification and spoofed sender", async () => {
    expect(await new DevBridgeVerifiedResultAdapter(reader({ events: [...events, events[1]!] })).verify(result)).toBe(false);
    expect(await new DevBridgeVerifiedResultAdapter(reader({ job: { ...job, result_verified_at: null as never } })).verify(result)).toBe(false);
    expect(await new DevBridgeVerifiedResultAdapter(reader({ events: [{ ...events[0]! }, { ...events[1]!, sender: "client" }] })).verify(result)).toBe(false);
  });
});
