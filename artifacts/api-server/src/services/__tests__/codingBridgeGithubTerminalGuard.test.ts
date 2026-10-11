import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("GitHub issue terminal evidence guard", () => {
  it("never closes an issue merely because a bridge COMPLETED callback arrived", () => {
    const source = readFileSync(
      new URL("../localCodingControlBridgeService.ts", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("async function syncTerminalBridgeResponseToGitHub");
    const end = source.indexOf("export async function submitCodingBridgeCommand", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const callback = source.slice(start, end);
    // Callback comments are informative, not authoritative final evidence.
    expect(callback).toContain("/comments");
    expect(callback).not.toMatch(/method:\\s*["']PATCH["']/);
    expect(callback).not.toMatch(/state_reason:\\s*["']completed["']/);
  });
});
