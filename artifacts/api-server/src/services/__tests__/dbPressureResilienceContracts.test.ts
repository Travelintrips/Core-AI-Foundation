import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("DB pressure resilience contracts", () => {
  it("keeps transient retry on model registry and planner context", () => {
    const model = readFileSync(
      new URL("../aiModelService.ts", import.meta.url),
      "utf8",
    );
    const planner = readFileSync(
      new URL("../localCodingAutomatedMultiTaskPlannerService.ts", import.meta.url),
      "utf8",
    );
    expect(model).toContain("withTransientDatabaseRetry");
    expect(model).toContain("{ attempts: 3, baseDelayMs: 150 }");
    expect(planner).toContain("withTransientDatabaseRetry");
    expect(planner).toContain("{ attempts: 4, baseDelayMs: 200 }");
  });

  it("retries task-graph read probes under transient DB pressure", () => {
    const graph = readFileSync(
      new URL("../localCodingTaskGraphService.ts", import.meta.url),
      "utf8",
    );    expect(graph).toContain("withTransientDatabaseRetry");
    expect(graph).toContain("{ attempts: 3, baseDelayMs: 150 }");
  });

  it("keeps raw query details out of AI Core Chat errors", () => {
    const route = readFileSync(
      new URL("../../routes/ai-core-chat.ts", import.meta.url),
      "utf8",
    );
    expect(route).toContain("isTransientDatabaseConnectionError");
    expect(route).toContain("Detail query disembunyikan dari tampilan chat");
  });
});
