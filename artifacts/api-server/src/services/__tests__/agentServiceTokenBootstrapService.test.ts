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
});
