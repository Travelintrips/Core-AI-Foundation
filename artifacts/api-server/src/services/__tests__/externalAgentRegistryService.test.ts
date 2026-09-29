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

  it("fails closed for unknown agents", () => {
    expect(getExternalAgentRule("untrusted-agent")).toBeNull();
  });

  it("never grants production deploy to an external agent", () => {
    for (const rule of Object.values(EXTERNAL_AGENT_RULES)) {
      expect(rule.permissions.productionDeploy).toBe(false);
    }
  });
});
