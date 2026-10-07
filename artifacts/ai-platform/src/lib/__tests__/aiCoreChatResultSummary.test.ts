import { describe, expect, it } from "vitest";
import { formatAiCoreInboxForChat } from "../aiCoreChatResultSummary";

describe("formatAiCoreInboxForChat", () => {
  it("extracts the human OpenClaw reply from a raw technical completion payload", () => {
    const raw = JSON.stringify({
      runId: "02a243b19-f15b-4de7-aadb-880628537ed2",
      status: "ok",
      summary: "completed",
      result: {
        payloads: [
          {
            text: "Cek apa? 😊 Kirim detailnya — mau cek status sistem, email, kalender, cuaca, atau yang lain?",
            mediaUrl: null,
          },
        ],
        meta: {
          durationMs: 10179,
          sessionId: "ai-core-work-secret-session",
          model: "ai-core-agent",
          contextTokens: 128000,
        },
      },
    });

    expect(formatAiCoreInboxForChat({
      eventType: "COMPLETED",
      title: "Task selesai",
      resultSummary: raw,
      message: raw,
    })).toEqual({
      title: "OpenClaw · Selesai ✅",
      summary: "Cek apa? 😊 Kirim detailnya — mau cek status sistem, email, kalender, cuaca, atau yang lain?",
    });
  });

  it("keeps ordinary summaries readable", () => {
    expect(formatAiCoreInboxForChat({
      eventType: "FAILED",
      title: "OpenClaw",
      resultSummary: "Browser node tidak tersedia.",
      message: "",
    })).toEqual({
      title: "OpenClaw · Gagal ❌",
      summary: "Browser node tidak tersedia.",
    });
  });

  it("caps unexpectedly long technical text in the main chat", () => {
    const result = formatAiCoreInboxForChat({
      eventType: "COMPLETED",
      title: "Task selesai",
      resultSummary: "x".repeat(900),
      message: "",
    });
    expect(result.summary.length).toBeLessThanOrEqual(520);
    expect(result.summary.endsWith("…")).toBe(true);
  });
});
