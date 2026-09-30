import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Ollama transient database retry contracts", () => {
  it("retries remote worker authentication and heartbeat on transient DB pressure", () => {
    const source = readFileSync(
      new URL("../remoteOllamaWorkerService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("withTransientDatabaseRetry(async () =>");
    expect(source).toContain("authenticateRemoteOllamaWorker");
    expect(source).toContain("heartbeatRemoteOllamaWorker");
    expect(source).toContain("{ attempts: 3, baseDelayMs: 100 }");
  });

  it("retries worker availability and hosted reservation lookup", () => {
    const remote = readFileSync(
      new URL("../remoteOllamaWorkerService.ts", import.meta.url),
      "utf8",
    );
    const registry = readFileSync(
      new URL("../ollamaWorkerRegistryService.ts", import.meta.url),
      "utf8",
    );

    expect(remote).toContain("hasRemoteOllamaWorker");
    expect(remote).toContain("return withTransientDatabaseRetry(async () =>");
    expect(registry).toContain("withTransientDatabaseRetry(");
    expect(registry).toContain("attemptReserveOllamaWorker(modelId)");
  });
});
