import { describe, expect, it } from "vitest";
import { EXTERNAL_AGENT_RULES, getExternalAgentRule } from "../externalAgentRegistryService.js";

describe("external agent registry policy", () => {
  it("locks canonical roles and capabilities inside AI Core", () => {
    expect(getExternalAgentRule("gcp-openclaw-main")).toMatchObject({
      source: "openclaw",
      role: "bounded_orchestration_agent",
    });
    expect(getExternalAgentRule("gcp-openhands-coder")).toMatchObject({
      source: "openhands",
      role: "coding_executor",
    });
    expect(getExternalAgentRule("gcp-n8n-automation")).toMatchObject({
      source: "n8n",
      role: "integration_automation_agent",
    });
  });

  it("registers three bounded Dell workers without production permissions", () => {
    for (const role of ["browser", "recovery", "verifier"]) {
      expect(getExternalAgentRule(`openclaw-pc-worker-dell-${role}`)).toMatchObject({
        source: "openclaw",
        role: "bounded_device_executor",
        permissions: { codingWorkspaceWrite: false, gitCommit: false, gitPush: false, productionDeploy: false },
      });
    }
  });

  it("grants PC2 only bounded DEV ChatGPT wake capability and no production permissions", () => {
    expect(getExternalAgentRule("openclaw-pc-worker-2")).toMatchObject({
      source: "openclaw",
      role: "bounded_device_executor",
      capabilities: expect.arrayContaining(["tools:bounded", "device:hostname", "chatgpt:wake"]),
      permissions: { codingWorkspaceWrite: false, gitCommit: false, gitPush: false, productionDeploy: false },
    });
  });

  it("fails closed for unknown agents", () => {
    expect(getExternalAgentRule("untrusted-agent")).toBeNull();
  });

  it("never grants production deploy to an external agent", () => {
    for (const rule of Object.values(EXTERNAL_AGENT_RULES)) {
      expect(rule.permissions.productionDeploy).toBe(false);
    }
  });
});
