import { describe, expect, it } from "vitest";
import {
  buildConversationPrompt,
  parseConversationCommand,
  redactConversationText,
  splitParallelWorkerCommands,
} from "../aiCoreConversationService.js";

describe("AI Core conversational gateway", () => {
  it("redacts secrets before transcript persistence or model prompting", () => {
    const value = redactConversationText(
      "pakai api_key=secret-value dan Authorization Bearer abc.def.ghi",
    );
    expect(value).not.toContain("secret-value");
    expect(value).not.toContain("abc.def.ghi");
    expect(value).toContain("[REDACTED]");
  });

  it("includes recent context for multi-turn reference resolution", () => {
    const prompt = buildConversationPrompt("Pakai yang lama.", [
      { role: "user", text: "Bikin aplikasi booking lapangan." },
      { role: "assistant", text: "Pakai Sport Center atau project baru?" },
    ]);
    expect(prompt).toContain("Sport Center");
    expect(prompt).toContain("Pakai yang lama.");
    expect(prompt).toContain("ask a concise clarification");
  });

  it("splits explicit multi-worker speech into separate commands", () => {
    expect(
      splitParallelWorkerCommands(
        "Worker satu audit Sport Center dan worker dua lanjut Customer Portal.",
      ),
    ).toEqual([
      "Worker satu audit Sport Center",
      "worker dua lanjut Customer Portal.",
    ]);
  });

  it("marks an unresolved reference as low confidence instead of guessing", () => {
    const parsed = parseConversationCommand("Lanjutkan yang tadi.", []);
    expect(parsed.ambiguous).toBe(true);
    expect(parsed.confidence).toBeLessThan(0.5);
  });

  it("keeps critical actions approval gated", () => {
    const parsed = parseConversationCommand(
      "merge pull request ini ke main",
      [],
    );
    expect(parsed.riskLevel).toBe("CRITICAL");
    expect(parsed.requiresApproval).toBe(true);
  });
});
