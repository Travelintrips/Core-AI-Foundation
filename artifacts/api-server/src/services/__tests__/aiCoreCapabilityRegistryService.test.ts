import { describe, expect, it, vi } from "vitest";

vi.mock("../externalAgentRegistryService.js", () => ({
  getExternalAgentRegistrySnapshot: vi.fn(async () => [
    {
      clientId: "gcp-openhands-coder",
      source: "openhands",
      role: "coding_executor",
      capabilities: ["coding:workspace", "coding:test"],
      permissions: {
        codingWorkspaceWrite: true,
        gitCommit: true,
        gitPush: true,
        productionDeploy: false,
      },
      presenceState: "ACTIVE",
      reportedHealth: "healthy",
      eligible: true,
      lastSeenAt: new Date("2026-09-30T00:00:00Z"),
      leaseExpiresAt: new Date("2026-09-30T00:02:00Z"),
      version: "test",
    },
  ]),
}));

vi.mock("../localCodingControlBridgeService.js", () => ({
  getCodingBridgeAvailability: vi.fn(async () => ({
    clientId: "gcp-temporal-coding-orchestrator",
    state: "ACTIVE",
    lastSeenAt: new Date("2026-09-30T00:00:00Z"),
    leaseExpiresAt: new Date("2026-09-30T00:02:00Z"),
  })),
}));

vi.mock("../localCodingAutonomousRepairService.js", () => ({
  TEMPORAL_CODING_ORCHESTRATOR_CLIENT_ID: "gcp-temporal-coding-orchestrator",
}));

import {
  getAiCoreCapabilityRegistrySnapshot,
  renderAiCoreCapabilityRegistry,
} from "../aiCoreCapabilityRegistryService.js";

describe("AI Core capability registry", () => {
  it("discovers configured resource families without exposing credentials", async () => {
    const snapshot = await getAiCoreCapabilityRegistrySnapshot({
      SUPABASE_PROD_DATABASE_URL: "postgresql://secret",
      GCP_OLLAMA_VM_PROJECT: "project",
      GCP_OLLAMA_VM_ZONE: "zone",
      GCP_OLLAMA_VM_INSTANCE: "instance",
      GCP_OLLAMA_COMPUTE_SA_JSON: "{secret}",
      HOSTINGER_API_TOKEN: "secret-token",
      HOSTINGER_VPS_ID: "123",
      HOSTINGER_DOCKER_PROJECT: "ai-core",
    });

    expect(snapshot.authority).toBe("ai-core");
    expect(snapshot.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "database.admin", state: "configured" }),
      expect.objectContaining({ id: "infrastructure.gcp-compute", state: "configured" }),
      expect.objectContaining({ id: "infrastructure.hostinger-vps", state: "configured" }),
      expect.objectContaining({ id: "orchestrator.temporal", state: "available" }),
      expect.objectContaining({ id: "agent.gcp-openhands-coder", state: "available" }),
    ]));

    const encoded = JSON.stringify(snapshot);
    expect(encoded).not.toContain("secret-token");
    expect(encoded).not.toContain("postgresql://secret");
    expect(encoded).not.toContain("{secret}");
  });

  it("marks unconfigured infrastructure unavailable and renders a compact summary", async () => {
    const snapshot = await getAiCoreCapabilityRegistrySnapshot({});
    expect(snapshot.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "infrastructure.gcp-compute", state: "unavailable" }),
      expect.objectContaining({ id: "infrastructure.hostinger-vps", state: "unavailable" }),
    ]));

    const text = renderAiCoreCapabilityRegistry(snapshot);
    expect(text).toContain("AI Core capability registry");
    expect(text).toContain("Secret dan credential tidak ditampilkan");
  });
});
