import { describe, expect, it } from "vitest";
import {
  isGcpOllamaVmWithinStartupGrace,
  readGcpOllamaVmConfig,
  shouldIssueGcpOllamaVmStart,
} from "../gcpOllamaVmLifecycleService.js";

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
    expect(config.idleShutdownMs).toBe(5 * 60_000);
  });

  it("supports an explicit idle shutdown timeout with a one minute floor", () => {
    expect(readGcpOllamaVmConfig({ GCP_OLLAMA_IDLE_SHUTDOWN_MS: "300000" }).idleShutdownMs).toBe(300000);
    expect(readGcpOllamaVmConfig({ GCP_OLLAMA_IDLE_SHUTDOWN_MS: "1000" }).idleShutdownMs).toBe(60000);
  });

  it("reissues start for a TERMINATED VM even inside the in-process cooldown", () => {
    const now = Date.parse("2026-10-05T08:30:00.000Z");
    expect(
      shouldIssueGcpOllamaVmStart("TERMINATED", now, now - 10_000, 60_000),
    ).toBe(true);
  });

  it("does not reissue start while Compute Engine is already starting or running", () => {
    const now = Date.parse("2026-10-05T08:30:00.000Z");
    for (const status of ["PROVISIONING", "STAGING", "RUNNING"]) {
      expect(
        shouldIssueGcpOllamaVmStart(status, now, 0, 60_000),
      ).toBe(false);
    }
  });

  it("keeps cooldown behavior for unknown transient status", () => {
    const now = Date.parse("2026-10-05T08:30:00.000Z");
    expect(shouldIssueGcpOllamaVmStart(null, now, now - 10_000, 60_000)).toBe(false);
    expect(shouldIssueGcpOllamaVmStart(null, now, now - 61_000, 60_000)).toBe(true);
  });

  it("protects a newly started VM for the full idle window even when prior activity is stale", () => {
    const startedAt = Date.parse("2026-10-05T03:14:36.000Z");
    expect(isGcpOllamaVmWithinStartupGrace(startedAt, startedAt + 4 * 60_000 + 59_000, 5 * 60_000)).toBe(true);
    expect(isGcpOllamaVmWithinStartupGrace(startedAt, startedAt + 5 * 60_000, 5 * 60_000)).toBe(false);
  });
});
