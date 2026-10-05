import { readFileSync } from "node:fs";
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

  it("retries caller-deadline cancellation bookkeeping on transient database failures", () => {
    const source = readFileSync(
      new URL("../remoteOllamaWorkerService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("() => cancelRemoteOllamaInvocation(jobId)");
    expect(source).toContain("{ attempts: 4, baseDelayMs: 250 }");
  });

  it("prewarms the remote Ollama model before advertising Economy capacity", () => {
    const source = readFileSync(
      new URL("../../scripts/remoteOllamaWorker.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain('OLLAMA_REMOTE_KEEP_ALIVE');
    expect(source).toContain('"15m"');
    expect(source).toContain('ollamaNativeBase + "/api/generate"');
    expect(source).toContain('prompt: ""');
    expect(source).toContain("AbortSignal.timeout(180_000)");
    expect(source).toContain("await warmLocalOllama();");
    expect(source).toContain("keep_alive: ollamaKeepAlive");
  });

  it("reconciles worker capacity after complete and retry bookkeeping", () => {
    const source = readFileSync(
      new URL("../remoteOllamaWorkerService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("reconcileRemoteOllamaWorkerCapacity");
    expect(source).toContain("COUNT(*)::int AS active_count");
    expect(source).toContain("payload_json->>'_claimedByWorkerId'");
    expect(source).toContain("await reconcileRemoteOllamaWorkerCapacity(workerId).catch");
    expect(source).toContain("await reconcileRemoteOllamaWorkerCapacity(existing.id).catch");
  });
});
// Registration is intentionally clamped to at least two slots server-side so
// an old/outdated remote worker cannot collapse production Economy capacity to 1.
