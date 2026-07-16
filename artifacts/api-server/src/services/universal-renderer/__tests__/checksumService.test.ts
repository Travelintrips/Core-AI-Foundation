/**
 * checksumService.test.ts — Team 14
 */

import { describe, it, expect } from "vitest";
import { computeChecksum, verifyChecksum } from "../checksumService.js";
import { RenderError } from "../errors.js";

describe("checksumService", () => {
  it("returns a 64-char hex SHA-256 string", () => {
    const chk = computeChecksum(Buffer.from("hello"));
    expect(chk).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same input", () => {
    const a = computeChecksum(Buffer.from("test data"));
    const b = computeChecksum(Buffer.from("test data"));
    expect(a).toBe(b);
  });

  it("differs for different inputs", () => {
    const a = computeChecksum(Buffer.from("foo"));
    const b = computeChecksum(Buffer.from("bar"));
    expect(a).not.toBe(b);
  });

  it("verifyChecksum passes for matching checksum", () => {
    const buf = Buffer.from("some content");
    const chk = computeChecksum(buf);
    expect(() => verifyChecksum(buf, chk)).not.toThrow();
  });

  it("verifyChecksum throws CHECKSUM_MISMATCH for wrong checksum", () => {
    const buf = Buffer.from("some content");
    expect(() => verifyChecksum(buf, "deadbeef".repeat(8))).toThrow(RenderError);
    expect(() => verifyChecksum(buf, "deadbeef".repeat(8))).toThrowError(
      expect.objectContaining({ code: "CHECKSUM_MISMATCH" }),
    );
  });
});
