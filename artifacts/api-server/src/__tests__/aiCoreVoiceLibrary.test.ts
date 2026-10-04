// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../routes/ai-core-chat.ts", import.meta.url),
  "utf8",
);

describe("AI Core provider voice library API", () => {
  it("exposes library readiness in config", () => {
    expect(source).toContain('libraryProvider: "elevenlabs"');
    expect(source).toContain('libraryProviderConfigured: Boolean(getProviderApiKey("elevenlabs"))');
    expect(source).toContain('libraryEndpoint: "/api/ai/core-chat/voices"');
  });

  it("lists provider voices and supports preview", () => {
    expect(source).toContain('router.get("/ai/core-chat/voices"');
    expect(source).toContain('router.post("/ai/core-chat/voices/:voiceId/preview"');
    expect(source).toContain('https://api.elevenlabs.io/v1/voices');
  });

  it("supports full reply synthesis with bounded input", () => {
    expect(source).toContain('const VoiceLibrarySpeakRequest = z.object({');
    expect(source).toContain('text: z.string().trim().min(1).max(1_200)');
    expect(source).toContain('router.post("/ai/core-chat/voices/:voiceId/speak"');
    expect(source).toContain('encodeURIComponent(voiceId)');
  });
});
