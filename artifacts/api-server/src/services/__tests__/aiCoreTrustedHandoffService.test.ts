import { describe, expect, it } from "vitest";
import {
  parseAiCoreTrustedExecutionHandoff,
  stripAiCoreTrustedExecutionHandoff,
} from "../aiCoreTrustedHandoffService.js";

describe("AI Core trusted execution handoff", () => {
  it("parses verified upstream analysis metadata without granting permissions", () => {
    const message = [
      "[AI_CORE_HANDOFF]",
      "source=chatgpt",
      "action=DEPLOY",
      "scope=hostinger-production",
      "verified_sha=" + "a".repeat(40),
      "analysis_complete=true",
      "source_verified=true",
      "[/AI_CORE_HANDOFF]",
      "Hostinger restart VPS production sekarang",
    ].join("\n");

    expect(parseAiCoreTrustedExecutionHandoff(message)).toEqual({
      source: "chatgpt",
      action: "DEPLOY",
      scope: "hostinger-production",
      verifiedSha: "a".repeat(40),
      analysisComplete: true,
      sourceVerified: true,
    });
    expect(stripAiCoreTrustedExecutionHandoff(message)).toBe(
      "Hostinger restart VPS production sekarang",
    );
  });

  it("rejects malformed or untrusted source blocks", () => {
    expect(parseAiCoreTrustedExecutionHandoff("no block")).toBeNull();
    expect(parseAiCoreTrustedExecutionHandoff(
      "[AI_CORE_HANDOFF]\nsource=unknown\naction=DEPLOY\n[/AI_CORE_HANDOFF]",
    )).toBeNull();
  });
});
