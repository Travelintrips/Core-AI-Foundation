import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("remote Ollama auth resilience contracts", () => {
  it("retries transient worker-auth database acquisition without bypassing token checks", () => {
    const source = readFileSync(
      new URL("../remoteOllamaWorkerService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("withTransientDatabaseRetry");
    expect(source).toContain("!safeEqual(token.trim(), worker.heartbeatToken)");
    expect(source).toContain("{ attempts: 2, baseDelayMs: 100 }");
  });

  it("returns 503 for transient auth database failures", () => {
    const route = readFileSync(
      new URL("../../routes/remote-ollama-worker.ts", import.meta.url),
      "utf8",
    );

    expect(route).toContain("isTransientDatabaseConnectionError");
    expect(route).toContain("Remote Ollama authentication temporarily unavailable");
    expect(route).toContain("res.status(503)");
  });

  it("reuses the authenticated worker during claim polling", () => {
    const route = readFileSync(
      new URL("../../routes/remote-ollama-worker.ts", import.meta.url),
      "utf8",
    );
    const source = readFileSync(
      new URL("../remoteOllamaWorkerService.ts", import.meta.url),
      "utf8",
    );

    expect(route).toContain('const worker = res.locals["remoteOllamaWorker"] as AiWorker');
    expect(route).toContain("claimRemoteOllamaInvocation(worker)");
    expect(source).toContain('worker: Pick<AiWorker, "id" | "modelId">');
    expect(source).not.toContain("const [candidate] = await db.select().from(aiWorkersTable)");
  });

  it("throttles stale-capacity recovery instead of running it on every poll", () => {
    const source = readFileSync(
      new URL("../remoteOllamaWorkerService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("REMOTE_OLLAMA_RECOVERY_THROTTLE_MS = 10_000");
    expect(source).toContain("maybeRecoverStaleRemoteOllamaCapacity");
  });
});
