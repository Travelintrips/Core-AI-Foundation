
import { describe, expect, it } from "vitest";
import {
  readOllamaWorkerRuntimeConfig,
} from "../ollamaWorkerRuntimeService.js";

describe("Ollama worker runtime configuration", () => {
  it("builds a bounded distributed worker config", () => {
    const config = readOllamaWorkerRuntimeConfig({
      OLLAMA_WORKER_RUNTIME_ENABLED: "true",
      OLLAMA_WORKER_NAME: "gpu-node-01",
      OLLAMA_WORKER_NODE_ID: "node-01",
      OLLAMA_WORKER_MODEL: "qwen2.5-coder:14b",
      OLLAMA_WORKER_LOCAL_URL:
        "http://127.0.0.1:11434/v1",
      OLLAMA_WORKER_ADVERTISE_URL:
        "http://10.10.0.21:11434/v1",
      OLLAMA_WORKER_MAX_CONCURRENCY: "4",
      OLLAMA_WORKER_HEARTBEAT_MS: "10000",
    } as NodeJS.ProcessEnv);

    expect(config).toMatchObject({
      enabled: true,
      workerName: "gpu-node-01",
      nodeId: "node-01",
      modelId: "qwen2.5-coder:14b",
      localBaseUrl:
        "http://127.0.0.1:11434/v1",
      advertiseBaseUrl:
        "http://10.10.0.21:11434/v1",
      maxConcurrentJobs: 4,
      heartbeatMs: 10000,
    });
  });

  it("clamps concurrency and heartbeat values", () => {
    const config = readOllamaWorkerRuntimeConfig({
      OLLAMA_WORKER_MAX_CONCURRENCY: "999",
      OLLAMA_WORKER_HEARTBEAT_MS: "1",
    } as NodeJS.ProcessEnv);

    expect(config.maxConcurrentJobs).toBe(32);
    expect(config.heartbeatMs).toBe(2000);
  });
});
