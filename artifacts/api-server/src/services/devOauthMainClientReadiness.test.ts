import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { deriveDevOauthMainClientChannel } from "./devOauthMainClientReadiness.js";

describe("DEV OAuth MAIN channel: isolated, read-only readiness identity", () => {
  const issuer = "https://dev.cstlogistic.co.id";
  it("derives precisely the existing OAuth MAIN user/client digest", () => {
    const digest = createHash("sha256").update(JSON.stringify([
      issuer, 5, "https://chatgpt.com/oauth/client.json",
    ])).digest("hex");
    expect(deriveDevOauthMainClientChannel(issuer, 5)).toBe("ai-engine-oauth:" + digest);
    expect(deriveDevOauthMainClientChannel(issuer + "/", 5)).toBe("ai-engine-oauth:" + digest);
  });
  it("does not confuse admin and historical job owner", () => {
    expect(deriveDevOauthMainClientChannel(issuer, 2))
      .not.toBe(deriveDevOauthMainClientChannel(issuer, 5));
  });
  it("does not allow an arbitrary issuer, invalid user or other environment", () => {
    for(const bad of ["https://aiengine.cstlogistic.co.id", "https://aicore.cstlogistic.co.id",
      "https://dev.cstlogistic.co.id.evil.example", "http://dev.cstlogistic.co.id"]) {
      expect(() => deriveDevOauthMainClientChannel(bad, 5)).toThrow("DEV_OAUTH_MAIN_IDENTITY_INVALID");
    }
    for(const id of [0, -1, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => deriveDevOauthMainClientChannel(issuer, id)).toThrow();
    }
  });
});
