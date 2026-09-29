import { describe, expect, it } from "vitest";
import {
  REMOTE_OLLAMA_MAX_RETRY,
  REMOTE_OLLAMA_RUNTIME_KIND,
  REMOTE_OLLAMA_STALE_RUNNING_MS,
} from "../remoteOllamaWorkerService.js";

describe("remote Ollama worker service", () => {
  it("keeps the remote-pull runtime identity stable", () => {
    expect(REMOTE_OLLAMA_RUNTIME_KIND).toBe("ollama_remote_pull");
  });

  it("keeps pending work off scarce GPU capacity until a fresh claim", () => {
    expect(REMOTE_OLLAMA_MAX_RETRY).toBe(0);
    expect(REMOTE_OLLAMA_STALE_RUNNING_MS).toBe(70_000);
  });
});
// Registration is intentionally clamped to at least two slots server-side so
// an old/outdated remote worker cannot collapse production Economy capacity to 1.
