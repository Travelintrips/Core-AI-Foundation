import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { appendLearningsToMessage, redactLearningText } from "../services/aiCoreChatLearningService.js";

describe("AI Core chat learning hardening", () => {
  it("redacts common secrets before persistence", () => {
    const input = "token=super-secret-value api_key=abc123 password=hunter2 Authorization: Bearer abc.def.ghi";
    const output = redactLearningText(input);
    expect(output).not.toContain("super-secret-value");
    expect(output).not.toContain("abc123");
    expect(output).not.toContain("hunter2");
    expect(output).not.toContain("abc.def.ghi");
    expect(output).toContain("[REDACTED]");
  });

  it("adds validated memory as bounded context without replacing the user command", () => {
    const command = "cek status worker";
    const output = appendLearningsToMessage(command, [{ content: "Jangan deploy tanpa approval." }]);
    expect(output.startsWith(command)).toBe(true);
    expect(output).toContain("VALIDATED AI CORE MEMORY");
    expect(output).toContain("Jangan deploy tanpa approval.");
  });

  it("does not modify a prompt when no validated memory exists", () => {
    expect(appendLearningsToMessage("hello", [])).toBe("hello");
  });
});


describe("AI Core local chat timeout contract", () => {
  it("fails local interactive chat before the production reverse-proxy deadline", () => {
    const source = readFileSync(
      new URL("../routes/ai-core-chat.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("Math.min(45_000, selection.timeoutMs + 10_000)");
    expect(source).not.toContain("Math.min(60_000, selection.timeoutMs + 15_000)");
  });
});
