
import { describe, expect, it } from "vitest";
import {
  calculateOllamaWorkerReconnectDelay,
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
      OLLAMA_WORKER_POWERSHELL_ENABLED: "true",
      OLLAMA_WORKER_HEARTBEAT_MS: "10000",
      OLLAMA_WORKER_RECONNECT_MIN_MS: "1500",
      OLLAMA_WORKER_RECONNECT_MAX_MS: "12000",
      OLLAMA_WORKER_HEALTHCHECK_TIMEOUT_MS: "3000",
      OLLAMA_WORKER_API_KEY: "worker-secret",
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
      apiKey: "worker-secret",
      maxConcurrentJobs: 1,
      powershellEnabled: true,
      heartbeatMs: 10000,
      reconnectMinMs: 1500,
      reconnectMaxMs: 12000,
      healthCheckTimeoutMs: 3000,
    });
  });

  it("clamps concurrency and heartbeat values", () => {
    const high = readOllamaWorkerRuntimeConfig({
      OLLAMA_WORKER_MAX_CONCURRENCY: "999",
      OLLAMA_WORKER_HEARTBEAT_MS: "1",
    } as NodeJS.ProcessEnv);
    const low = readOllamaWorkerRuntimeConfig({
      OLLAMA_WORKER_MAX_CONCURRENCY: "1",
    } as NodeJS.ProcessEnv);

    expect(high.maxConcurrentJobs).toBe(1);
    expect(high.heartbeatMs).toBe(2000);
    expect(low.maxConcurrentJobs).toBe(1);
  });

  it("keeps reconnect bounds valid and uses exponential backoff", () => {
    const config = readOllamaWorkerRuntimeConfig({
      OLLAMA_WORKER_RECONNECT_MIN_MS: "5000",
      OLLAMA_WORKER_RECONNECT_MAX_MS: "1000",
      OLLAMA_WORKER_HEALTHCHECK_TIMEOUT_MS: "999999",
    } as NodeJS.ProcessEnv);

    expect(config.reconnectMinMs).toBe(5000);
    expect(config.reconnectMaxMs).toBe(5000);
    expect(config.healthCheckTimeoutMs).toBe(30000);
    expect(calculateOllamaWorkerReconnectDelay(1, 2000, 30000)).toBe(2000);
    expect(calculateOllamaWorkerReconnectDelay(2, 2000, 30000)).toBe(4000);
    expect(calculateOllamaWorkerReconnectDelay(5, 2000, 30000)).toBe(30000);
  });
});
