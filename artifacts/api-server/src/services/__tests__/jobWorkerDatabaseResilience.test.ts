import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("job worker bookkeeping database resilience", () => {
  it("wraps job and worker bookkeeping reads in transient database retry", () => {
    const source = readFileSync(
      new URL("../jobWorkerService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("withTransientDatabaseRetry");
    expect(source).toContain("{ attempts: 5, baseDelayMs: 250 }");
    expect(source).toContain("{ attempts: 3, baseDelayMs: 150 }");

    const directJobRead = [
      "const [job] = await db",
      ".select()",
      ".from(aiJobsTable)",
      ".where(eq(aiJobsTable.id, jobId));",
    ].join("\n");
    expect(source).not.toContain(directJobRead);
  });
});
