import { describe, expect, it } from "vitest";
import { REMOTE_OLLAMA_RUNTIME_KIND } from "../remoteOllamaWorkerService.js";

describe("remote Ollama worker service", () => {
  it("keeps the remote-pull runtime identity stable", () => {
    expect(REMOTE_OLLAMA_RUNTIME_KIND).toBe("ollama_remote_pull");
  });
});
// Remote workers default to one inference slot. A deployment may opt into higher
// concurrency explicitly, but a single GPU must not be forced to execute two
// generations concurrently; excess work stays in the durable queue.
