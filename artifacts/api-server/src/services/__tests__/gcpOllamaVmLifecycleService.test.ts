import { describe, expect, it } from "vitest";
import { readGcpOllamaVmConfig } from "../gcpOllamaVmLifecycleService.js";

describe("GCP Ollama VM lifecycle config", () => {
  it("is disabled by default", () => {
    const config = readGcpOllamaVmConfig({});
    expect(config.enabled).toBe(false);
  });

  it("reads an explicitly enabled VM target without exposing credential content", () => {
    const config = readGcpOllamaVmConfig({
      GCP_OLLAMA_AUTOSTART_ENABLED: "true",
      GCP_OLLAMA_VM_PROJECT: "ollama-project",
      GCP_OLLAMA_VM_ZONE: "asia-northeast1-c",
      GCP_OLLAMA_VM_INSTANCE: "gpu-worker",
      GCP_OLLAMA_COMPUTE_SA_JSON: "{\"type\":\"service_account\"}",
    });
    expect(config.enabled).toBe(true);
    expect(config.projectId).toBe("ollama-project");
    expect(config.zone).toBe("asia-northeast1-c");
    expect(config.instanceName).toBe("gpu-worker");
  });
});
