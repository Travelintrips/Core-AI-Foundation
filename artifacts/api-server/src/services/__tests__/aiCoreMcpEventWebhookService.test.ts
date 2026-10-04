import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  decodeStandardWebhookSecret,
  matchesTerminalEventArguments,
  signStandardWebhook,
} from "../aiCoreMcpEventWebhookService.js";

describe("AI Core MCP event webhook helpers", () => {
  it("implements Standard Webhooks HMAC signing", () => {
    const rawSecret = Buffer.alloc(24, 7);
    const secret = `whsec_${rawSecret.toString("base64")}`;
    const body = JSON.stringify({ eventId: "evt_1", name: "ai_core.task.terminal" });
    const timestamp = 1791158400;
    const expected = createHmac("sha256", rawSecret)
      .update(`evt_1.${timestamp}.${body}`)
      .digest("base64");

    expect(decodeStandardWebhookSecret(secret)).toEqual(rawSecret);
    expect(signStandardWebhook(secret, "evt_1", timestamp, body))
      .toBe(`v1,${expected}`);
  });

  it("canonicalizes subscription arguments independent of object key order", () => {
    expect(canonicalJson({
      repository: "Travelintrips/Core-AI-Foundation",
      taskId: "task-a",
      eventTypes: ["COMPLETED", "FAILED"],
    })).toBe(canonicalJson({
      eventTypes: ["COMPLETED", "FAILED"],
      taskId: "task-a",
      repository: "Travelintrips/Core-AI-Foundation",
    }));
  });

  it("matches terminal events only when all supplied filters match", () => {
    const args = {
      repository: "Travelintrips/Core-AI-Foundation",
      projectName: "Core AI Foundation",
      eventTypes: ["COMPLETED"] as const,
    };

    expect(matchesTerminalEventArguments(
      { ...args, eventTypes: [...args.eventTypes] },
      {
        taskId: "task-a",
        repository: "Travelintrips/Core-AI-Foundation",
        projectName: "Core AI Foundation",
        eventType: "COMPLETED",
      },
    )).toBe(true);

    expect(matchesTerminalEventArguments(
      { ...args, eventTypes: [...args.eventTypes] },
      {
        taskId: "task-a",
        repository: "Travelintrips/Core-AI-Foundation",
        projectName: "Core AI Foundation",
        eventType: "FAILED",
      },
    )).toBe(false);
  });
});
