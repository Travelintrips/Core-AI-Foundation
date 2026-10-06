import { describe, expect, it } from "vitest";
import {
  buildConversationPrompt,
  contextualizeConversationCommand,
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

  it("contextualizes terse follow-up commands from the recent conversation", () => {
    const resolved = contextualizeConversationCommand("merge", [
      { role: "user", text: "cek PR #695 dan pastikan CI hijau" },
      { role: "assistant", text: "PR #695 sudah hijau dan siap merge." },
    ]);

    expect(resolved).toContain("merge");
    expect(resolved).toContain("PR #695");
    expect(resolved).toContain("single active target");
  });

  it("routes terse follow-ups using recovered target context", () => {
    const parsed = parseConversationCommand("merge", [
      { role: "assistant", text: "PR #695 sudah hijau dan siap merge." },
    ]);

    expect(parsed.ambiguous).toBe(false);
    expect(parsed.riskLevel).toBe("MUTATING");
  });

  it("asks for clarification when a terse follow-up has multiple PR targets", () => {
    const parsed = parseConversationCommand("merge", [
      { role: "user", text: "PR #695 sudah hijau." },
      { role: "assistant", text: "PR #696 juga siap." },
    ]);

    expect(parsed.ambiguous).toBe(true);
    expect(parsed.confidence).toBeLessThan(0.5);
  });

  it("treats normal pull-request merge as autonomous repository mutation", () => {
    const parsed = parseConversationCommand(
      "merge pull request ini ke main",
      [],
    );
    expect(parsed.riskLevel).toBe("MUTATING");
    expect(parsed.requiresApproval).toBe(false);
  });

  it.each([
    "deploy ke production sekarang",
    "rotate secret production",
    "hapus database production",
    "ubah IAM role service account",
  ])("keeps genuinely critical actions approval gated: %s", (message) => {
    const parsed = parseConversationCommand(message, []);
    expect(parsed.riskLevel).toBe("CRITICAL");
    expect(parsed.requiresApproval).toBe(true);
  });
});
