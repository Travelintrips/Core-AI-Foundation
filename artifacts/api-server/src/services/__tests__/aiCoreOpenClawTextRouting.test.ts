import { describe, expect, it } from "vitest";
import { classifyAiCoreChatDispatch } from "../aiCoreChatIntentService.js";

describe("DEV OpenClaw reply dispatch", () => {
  it("routes a constrained text reply to the VPS agent", () => {
    const decision = classifyAiCoreChatDispatch("OpenClaw VPS DEV delivery verification: return EXACT text OK without tools.");
    expect(decision.kind).toBe("EXTERNAL_AGENT");
    expect(decision.externalAgentClientId).toBe("openclaw-vps-main");
    expect(decision.executionLane).toBe("TARGETED");
  });
});
