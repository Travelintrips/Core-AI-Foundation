import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  aiMemoryTable: {},
  db: {},
}));

import {
  isTeacherQuestionCacheable,
  scoreTeacherQuestionSimilarity,
} from "../aiCoreChatLearningService.js";

describe("AI Core OpenAI teacher learning guards", () => {
  it("treats the exact same static question as a perfect match", () => {
    expect(
      scoreTeacherQuestionSimilarity(
        "Apa fungsi Redis external untuk WA Gateway?",
        "Apa fungsi Redis external untuk WA Gateway?",
      ),
    ).toBe(1);
  });

  it("scores related wording without treating every similar sentence as identical", () => {
    const score = scoreTeacherQuestionSimilarity(
      "Jelaskan fungsi Redis external untuk WA Gateway",
      "Apa fungsi Redis external pada WA Gateway",
    );
    expect(score).toBeGreaterThan(0.6);
    expect(score).toBeLessThan(1);
  });

  it("allows stable knowledge questions to become teacher references", () => {
    expect(
      isTeacherQuestionCacheable("Apa fungsi Redis external untuk WA Gateway?"),
    ).toBe(true);
  });

  it.each([
    "Berapa harga OpenAI hari ini?",
    "Apa status production sekarang?",
    "Cek workflow CI terbaru",
    "Bagaimana cuaca hari ini?",
  ])("rejects dynamic or freshness-sensitive questions: %s", (question) => {
    expect(isTeacherQuestionCacheable(question)).toBe(false);
  });

  it("rejects tiny prompts that are unsafe to reuse as knowledge", () => {
    expect(isTeacherQuestionCacheable("halo")).toBe(false);
  });
});
