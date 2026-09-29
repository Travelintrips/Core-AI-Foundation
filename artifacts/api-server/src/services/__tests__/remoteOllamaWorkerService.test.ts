import { describe, expect, it } from "vitest";
import { REMOTE_OLLAMA_RUNTIME_KIND } from "../remoteOllamaWorkerService.js";

describe("remote Ollama worker service", () => {
  it("keeps the remote-pull runtime identity stable", () => {
    expect(REMOTE_OLLAMA_RUNTIME_KIND).toBe("ollama_remote_pull");
  });
});
