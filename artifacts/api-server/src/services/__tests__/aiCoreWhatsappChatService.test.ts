import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../aiCoreChatLearningService.js", () => ({
  retrieveRecentChatContext: vi.fn().mockResolvedValue([]),
}));

vi.mock("../aiSecretService.js", () => ({
  getProviderApiKey: vi.fn(() => null),
}));

import {
  sendAiCoreWhatsappReply,
  shouldRetryAiCoreWhatsappGatewayStatus,
} from "../aiCoreWhatsappChatService.js";

describe("AI Core WhatsApp gateway delivery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["CST_WA_GATEWAY_URL"];
    delete process.env["CST_WA_GATEWAY_API_KEY"];
    delete process.env["AI_CORE_WA_GATEWAY_RETRY_DELAY_MS"];
  });

  it("classifies only bounded transient HTTP failures as retryable", () => {
    expect(shouldRetryAiCoreWhatsappGatewayStatus(408)).toBe(true);
    expect(shouldRetryAiCoreWhatsappGatewayStatus(429)).toBe(true);
    expect(shouldRetryAiCoreWhatsappGatewayStatus(502)).toBe(true);
    expect(shouldRetryAiCoreWhatsappGatewayStatus(503)).toBe(true);
    expect(shouldRetryAiCoreWhatsappGatewayStatus(400)).toBe(false);
    expect(shouldRetryAiCoreWhatsappGatewayStatus(401)).toBe(false);
    expect(shouldRetryAiCoreWhatsappGatewayStatus(403)).toBe(false);
  });

  it("retries a transient gateway failure with the same idempotency key", async () => {
    process.env["CST_WA_GATEWAY_URL"] = "https://wa-gateway.example.test";
    process.env["CST_WA_GATEWAY_API_KEY"] = "test-key";
    process.env["AI_CORE_WA_GATEWAY_RETRY_DELAY_MS"] = "25";

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("temporary unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ messageId: "wa-message-1" }),
        { status: 202, headers: { "content-type": "application/json" } },
      ));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendAiCoreWhatsappReply({
      to: "628111111111",
      incomingMessageId: "incoming-1",
      text: "Halo",
    });

    expect(result).toEqual({
      status: "queued",
      gatewayStatus: 202,
      messageId: "wa-message-1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstHeaders = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    const secondHeaders = (fetchMock.mock.calls[1]?.[1] as RequestInit).headers as Record<string, string>;
    expect(firstHeaders["idempotency-key"]).toBe("ai-core-chat-incoming-1");
    expect(secondHeaders["idempotency-key"]).toBe(firstHeaders["idempotency-key"]);
  });

  it("does not retry a non-transient authorization rejection", async () => {
    process.env["CST_WA_GATEWAY_URL"] = "https://wa-gateway.example.test";
    process.env["CST_WA_GATEWAY_API_KEY"] = "test-key";

    const fetchMock = vi.fn().mockResolvedValue(
      new Response("forbidden", { status: 403 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendAiCoreWhatsappReply({
      to: "628111111111",
      incomingMessageId: "incoming-2",
      text: "Halo",
    });

    expect(result).toEqual({
      status: "rejected",
      gatewayStatus: 403,
      body: "forbidden",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
