import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("AI Core startup autonomous readiness", () => {
  it("starts the autonomous runtime after DB auth guard but before slow startup initializers", () => {
    const source = readFileSync(
      new URL("../../index.ts", import.meta.url),
      "utf8",
    );

    const dbGuard = source.indexOf('await pool.query("SELECT 1")');
    const autonomous = source.indexOf('"[coding-autonomous] Runtime start"');
    const observability = source.indexOf('"[observability] Table init"');

    expect(dbGuard).toBeGreaterThan(0);
    expect(autonomous).toBeGreaterThan(dbGuard);
    expect(observability).toBeGreaterThan(autonomous);
    expect(
      source.match(/\[coding-autonomous\] Runtime start/g)?.length ?? 0,
    ).toBe(1);
  });
});
