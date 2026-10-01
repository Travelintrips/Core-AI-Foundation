import { describe, expect, it } from "vitest";
import { normalizeExecFileStdout } from "../execFileOutputService.js";

describe("normalizeExecFileStdout", () => {
  it("accepts direct string, Buffer, Uint8Array, and object stdout shapes", () => {
    expect(normalizeExecFileStdout("abc\n")).toBe("abc\n");
    expect(normalizeExecFileStdout(Buffer.from("def\n"))).toBe("def\n");
    expect(normalizeExecFileStdout(new Uint8Array(Buffer.from("ghi\n")))).toBe("ghi\n");
    expect(normalizeExecFileStdout({ stdout: "jkl\n" })).toBe("jkl\n");
    expect(normalizeExecFileStdout({ stdout: Buffer.from("mno\n") })).toBe("mno\n");
  });

  it("fails closed to an empty string for unsupported output shapes", () => {
    expect(normalizeExecFileStdout(undefined)).toBe("");
    expect(normalizeExecFileStdout(null)).toBe("");
    expect(normalizeExecFileStdout({})).toBe("");
  });
});
