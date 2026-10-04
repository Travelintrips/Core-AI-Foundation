// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./coding-workspace.tsx", import.meta.url),
  "utf8",
);

describe("coding workspace worker metadata presentation", () => {
  it("surfaces retired legacy worker suppression without presenting it as provider failure", () => {
    expect(source).toContain("retiredLegacy?: number");
    expect(source).toContain("legacy retired hidden");
    expect(source).toContain("monitor.workers.retiredLegacy");
  });
});
