import { describe, expect, it } from "vitest";
import { REMOTE_OLLAMA_RUNTIME_KIND } from "../remoteOllamaWorkerService.js";

describe("remote Ollama worker service", () => {
  it("keeps the remote-pull runtime identity stable", () => {
    expect(REMOTE_OLLAMA_RUNTIME_KIND).toBe("ollama_remote_pull");
  });
});
// Registration is intentionally clamped to at least two slots server-side so
// an old/outdated remote worker cannot collapse production Economy capacity to 1.
