import { describe, expect, it } from "vitest";
import { parseDirectConversationEventRequest } from "../aiCoreConversationEventControlService.js";

describe("AI Core direct ChatGPT conversation event parsing", () => {
  it("parses a bridge message request without requiring the @ prefix", () => {
    expect(parseDirectConversationEventRequest(
      "Kirim pesan ke ChatGPT conversation 6ac56e2f-e6e0-83ec-b9e4-febea0929e10 melalui bridge/event binding yang terhubung ke conversation tersebut. Isi pesan persis: TES_DARI_AICORE_OK. Jangan coding, jangan gunakan worker, jangan ubah repository.",
    )).toEqual({
      conversationId: "6ac56e2f-e6e0-83ec-b9e4-febea0929e10",
      eventType: "COMPLETED",
      message: "TES_DARI_AICORE_OK",
    });
  });

  it("parses an explicit native MCP terminal event", () => {
    expect(parseDirectConversationEventRequest(
      "Kirim native event COMPLETED ke ChatGPT conversation 6ac56e2f-e6e0-83ec-b9e4-febea0929e10 dengan pesan: TES_AUTO_WAKE_OK. Gunakan native MCP event ai_core.task.terminal, jangan polling.",
    )).toEqual({
      conversationId: "6ac56e2f-e6e0-83ec-b9e4-febea0929e10",
      eventType: "COMPLETED",
      message: "TES_AUTO_WAKE_OK",
    });
  });

  it("does not hijack ordinary conversational text", () => {
    expect(parseDirectConversationEventRequest(
      "Apakah native MCP event sudah aktif untuk ChatGPT?",
    )).toBeNull();
  });
});
