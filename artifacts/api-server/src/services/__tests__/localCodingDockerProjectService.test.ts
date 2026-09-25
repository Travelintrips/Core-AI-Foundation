import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dockerDeploymentPlan,
  inspectAndVerifyDockerProject,
  inspectDockerProject,
} from "../localCodingDockerProjectService.js";

const originalDeployFlag = process.env["AI_CODING_DOCKER_DEPLOY_ENABLED"];

afterEach(() => {
  if (originalDeployFlag === undefined) delete process.env["AI_CODING_DOCKER_DEPLOY_ENABLED"];
  else process.env["AI_CODING_DOCKER_DEPLOY_ENABLED"] = originalDeployFlag;
});

async function fixture(files: Record<string,string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "docker-project-"));
  for (const [name, body] of Object.entries(files)) await writeFile(join(root, name), body, "utf8");
  return root;
}

describe("localCodingDockerProjectService", () => {
  it("detects a compose project and derives bounded service metadata", async () => {
    delete process.env["AI_CODING_DOCKER_DEPLOY_ENABLED"];
    const root = await fixture({
      "Dockerfile": "FROM node:22-alpine\n",
      "docker-compose.yml": `services:
  api:
    build: .
    healthcheck:
      test: ["CMD", "node", "-v"]
  redis:
    image: redis:7-alpine
`,
    });
    const profile = await inspectDockerProject(root);
    expect(profile.kind).toBe("docker-compose");
    expect(profile.composeFile).toBe("docker-compose.yml");
    expect(profile.dockerfile).toBe("Dockerfile");
    expect(profile.services).toEqual([
      { name: "api", hasBuild: true, hasImage: false, hasHealthcheck: true },
      { name: "redis", hasBuild: false, hasImage: true, hasHealthcheck: false },
    ]);
    expect(profile.hasHealthcheck).toBe(true);
    expect(profile.deploymentSupported).toBe(false);
    expect(profile.safeVerificationCommands).toEqual([
      "docker compose -f docker-compose.yml config --quiet",
      "docker build --check -f Dockerfile .",
    ]);
  });

  it("fails closed before executing Docker verification in an untrusted workspace", async () => {
    const root = await fixture({"Dockerfile":"FROM scratch\n"});
    const executor = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const result = await inspectAndVerifyDockerProject(root, { executor });
    expect(executor).not.toHaveBeenCalled();
    expect(result.verification[0]?.status).toBe("BLOCKED");
  });

  it("executes only the generated allowlisted verification commands in a trusted workspace", async () => {
    const root = await fixture({
      "Dockerfile": "FROM node:22-alpine\n",
      "compose.yaml": "services:\n  api:\n    build: .\n",
    });
    const executor = vi.fn(async () => ({ stdout: "ok", stderr: "" }));
    const result = await inspectAndVerifyDockerProject(root, { trustedWorkspace: true, executor });
    expect(result.verification.map((v) => v.status)).toEqual(["PASSED", "PASSED"]);
    expect(executor).toHaveBeenNthCalledWith(
      1,
      "docker",
      ["compose", "-f", "compose.yaml", "config", "--quiet"],
      expect.objectContaining({ cwd: root }),
    );
  });

  it("returns a deployment plan only when the production gate is explicitly enabled", async () => {
    process.env["AI_CODING_DOCKER_DEPLOY_ENABLED"] = "true";
    const root = await fixture({"compose.yml":"services:\n  api:\n    image: example/api:latest\n"});
    const profile = await inspectDockerProject(root);
    expect(profile.deploymentSupported).toBe(true);
    expect(dockerDeploymentPlan(profile)).toEqual([
      "docker compose -f compose.yml pull",
      "docker compose -f compose.yml build --pull",
      "docker compose -f compose.yml up -d --remove-orphans",
      "docker compose -f compose.yml ps",
    ]);
  });

  it("does not claim Docker support for a non-Docker repository", async () => {
    process.env["AI_CODING_DOCKER_DEPLOY_ENABLED"] = "true";
    const root = await fixture({"package.json":"{}"});
    const profile = await inspectDockerProject(root);
    expect(profile.kind).toBe("none");
    expect(profile.deploymentSupported).toBe(false);
    expect(dockerDeploymentPlan(profile)).toEqual([]);
  });
});
