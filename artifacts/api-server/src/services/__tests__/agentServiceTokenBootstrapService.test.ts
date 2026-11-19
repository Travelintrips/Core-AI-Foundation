import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("agent service token bootstrap idempotency", () => {
  it("treats the scoped worker token hash as the stable bootstrap identity", () => {
    const source = readFileSync(
      new URL("../agentServiceTokenBootstrapService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("ON CONFLICT (token_hash) DO UPDATE");
    expect(source).not.toContain("ON CONFLICT (name) DO UPDATE");
    expect(source).toContain("existing.token_hash = ${tokenHash}");
  });

  it("bootstraps the PC2 token only from a DEV-only SHA-256 hash with bounded scopes", () => {
    const source = readFileSync(
      new URL("../agentServiceTokenBootstrapService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain('AI_CORE_DEV_PC2_AGENT_TOKEN_HASH');
    expect(source).toContain('process.env["NODE_ENV"] === "production"');
    expect(source).toContain('DEV_PC2_TOKEN_NAME = "openclaw-pc-worker-2"');
    expect(source).toContain("ARRAY['agent:presence','agent:work']::text[]");
    expect(source).toContain('"source":"dev-pc2-hash-bootstrap"');
  });
});
