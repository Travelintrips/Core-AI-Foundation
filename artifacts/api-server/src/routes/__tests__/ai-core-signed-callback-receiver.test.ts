import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkInboundSignature } from "../ai-core-signed-callback-receiver.js";

describe("isolated callback receiver verification", () => {
  const secret = "whsec_" + Buffer.alloc(24, 3).toString("base64");
  const eventId = "evt_" + "a".repeat(40);
  const body = Buffer.from(JSON.stringify({ eventId, name: "ai_core.task.terminal" }));
  const timestamp = "1791650000";
  const now = Number(timestamp) * 1000;
  const sign = () => "v1," + createHmac("sha256", Buffer.alloc(24, 3))
    .update(eventId + "." + timestamp + "." + body.toString("utf8")).digest("base64");
  it("accepts correctly signed, fresh, exact body", () => {
    expect(checkInboundSignature({ secret, eventId, timestamp, signature: sign(), body, now })).toBe(true);
  });
  it("rejects altered body, expired timestamps and incorrect signatures", () => {
    const input = { secret, eventId, timestamp, signature: sign(), body, now };
    expect(checkInboundSignature({ ...input, body: Buffer.from("{}") })).toBe(false);
    expect(checkInboundSignature({ ...input, now: now + 600_000 })).toBe(false);
    expect(checkInboundSignature({ ...input, signature: "v1," + Buffer.alloc(32).toString("base64") })).toBe(false);
  });
});
