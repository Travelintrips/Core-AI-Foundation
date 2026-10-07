import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildStandardWebhookSignatureHeader,
  canonicalJson,
  choosePreferredCallbackAddress,
  decodeStandardWebhookSecret,
  matchesTerminalEventArguments,
  oauthPrincipalUserId,
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


  it("dual-signs during the bounded webhook secret rotation window", () => {
    const current = `whsec_${Buffer.alloc(24, 3).toString("base64")}`;
    const previous = `whsec_${Buffer.alloc(24, 4).toString("base64")}`;
    const body = JSON.stringify({ eventId: "evt_rotate" });
    const timestamp = 1791158400;
    const nowMs = 1791158400 * 1000;

    expect(
      buildStandardWebhookSignatureHeader({
        currentSecret: current,
        previousSecret: previous,
        previousSecretValidUntil: new Date(nowMs + 60_000),
        messageId: "evt_rotate",
        timestampSeconds: timestamp,
        body,
        nowMs,
      }),
    ).toBe(
      `${signStandardWebhook(current, "evt_rotate", timestamp, body)} ${signStandardWebhook(previous, "evt_rotate", timestamp, body)}`,
    );

    expect(
      buildStandardWebhookSignatureHeader({
        currentSecret: current,
        previousSecret: previous,
        previousSecretValidUntil: new Date(nowMs - 1),
        messageId: "evt_rotate",
        timestampSeconds: timestamp,
        body,
        nowMs,
      }),
    ).toBe(signStandardWebhook(current, "evt_rotate", timestamp, body));
  });

  it("parses only valid OAuth principal user ids for access revalidation", () => {
    expect(oauthPrincipalUserId("oauth:123")).toBe(123);
    expect(oauthPrincipalUserId("oauth:0")).toBeNull();
    expect(oauthPrincipalUserId("oauth:not-a-number")).toBeNull();
    expect(oauthPrincipalUserId("legacy:abcdef")).toBeNull();
  });

  it("prefers IPv4 for callback verification when both address families are available", () => {
    expect(choosePreferredCallbackAddress([
      { address: "2001:4860:4860::8888", family: 6 },
      { address: "8.8.8.8", family: 4 },
    ])).toEqual({ address: "8.8.8.8", family: 4 });

    expect(choosePreferredCallbackAddress([
      { address: "2001:4860:4860::8888", family: 6 },
    ])).toEqual({ address: "2001:4860:4860::8888", family: 6 });

    expect(choosePreferredCallbackAddress([])).toBeNull();
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
