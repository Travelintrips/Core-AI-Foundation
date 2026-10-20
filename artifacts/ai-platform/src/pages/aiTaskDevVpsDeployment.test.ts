// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fromRoot = (path: string) =>
  readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");

describe("canonical AI Task DEV deployment route", () => {
  const shared = fromRoot(".github/workflows/hostinger-dev-console-deploy.yml");
  const vps = fromRoot(".github/workflows/hostinger-dev-deploy.yml");
  const policy = fromRoot("docs/DEV_FIRST_RELEASE_POLICY.md");

  it("never automatically deploys the legacy shared-hosting console on develop push", () => {
    const trigger = shared.split("\non:\n")[1]?.split("\npermissions:")[0] ?? "";
    expect(trigger).toContain("workflow_dispatch:");
    expect(trigger).not.toMatch(/\bpush:/);
    expect(shared).toContain("dev-aicore.cstlogistic.co.id");
  });

  it("retains CI-gated VPS DEV route and production isolation checks", () => {
    expect(vps).toContain("name: Hostinger DEV Deploy");
    expect(vps).toContain("branches: [develop]");
    expect(vps).toContain("dev.cstlogistic.co.id");
    expect(vps).toContain("aicore.cstlogistic.co.id");
    expect(vps).toContain("Wait for CI-gated VPS DEV build and exact release");
    expect(vps).toContain("PROD_BASELINE_SHA");
    expect(vps).not.toContain("HOSTINGER_API_TOKEN");
  });

  it("documents the same canonical DEV host as the production promotion gate", () => {
    const gate = fromRoot("scripts/verify-dev-first-release.mjs");
    expect(policy).toContain("https://dev.cstlogistic.co.id/aicoding");
    expect(policy).toContain("https://dev.cstlogistic.co.id/api/healthz");
    expect(gate).toContain('DEV_HEALTH_ENDPOINT = "https://dev.cstlogistic.co.id/api/healthz"');
  });
});
