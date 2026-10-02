import { describe, expect, it } from "vitest";
import { extractLocalCodingGitStdout } from "../localCodingGitOutputService.js";

describe("local coding git output normalization", () => {
  it.each([
    ["direct string", "abc\n", "abc\n"],
    ["object string", { stdout: "abc\n" }, "abc\n"],
    ["direct buffer", Buffer.from("abc\n"), "abc\n"],
    ["object buffer", { stdout: Buffer.from("abc\n") }, "abc\n"],
    ["direct uint8", new Uint8Array(Buffer.from("abc\n")), "abc\n"],
    ["object uint8", { stdout: new Uint8Array(Buffer.from("abc\n")) }, "abc\n"],
    ["empty clean-worktree output", { stdout: "" }, ""],
  ])("normalizes %s", (_label, input, expected) => {
    expect(extractLocalCodingGitStdout(input)).toBe(expected);
  });

  it.each([undefined, null, {}, { stdout: undefined }])(
    "fails closed for unsupported stdout shape",
    (input) => {
      expect(() => extractLocalCodingGitStdout(input)).toThrow(
        "Git command returned an unsupported stdout shape.",
      );
    },
  );
});
