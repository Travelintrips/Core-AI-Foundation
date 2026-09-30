import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("planner database resilience contracts", () => {
  it("retries planner authority database transactions and makes release idempotent", () => {
    const source = readFileSync(
      new URL("../localCodingPlannerAuthorityService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("withTransientDatabaseRetry");
    expect(source).toContain("{ attempts: 4, baseDelayMs: 200 }");
    expect(source).toContain("if (!row) return;");
  });

  it("does not let transient authority cleanup mask a persisted plan", () => {
    const source = readFileSync(
      new URL("../localCodingAutomatedMultiTaskPlannerService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("isTransientDatabaseConnectionError(error)");
    expect(source).toContain("await releasePlannerAuthority");
  });

  it("retries idempotent task graph reads, persistence, and approval", () => {
    const source = readFileSync(
      new URL("../localCodingTaskGraphService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("withTransientDatabaseRetry");
    expect(source).toContain('if (graph.status === "APPROVED")');
    expect(source).toContain("{ attempts: 4, baseDelayMs: 200 }");
  });
});
