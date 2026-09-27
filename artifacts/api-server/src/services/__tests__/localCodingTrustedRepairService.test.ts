import { describe, expect, it } from "vitest";
import { extractExplicitTrustedRepairFiles } from "../localCodingTrustedRepairService.js";

describe("trusted Ollama repair allowlist extraction", () => {
  it("allows only explicit repository-relative file paths from the task instruction", () => {
    const files = extractExplicitTrustedRepairFiles(
      "Perbaiki test gagal autonomousRepairLive.smoke.test.ts. " +
      "Hanya ubah artifacts/api-server/src/services/__tests__/fixtures/autonomousRepairLiveTarget.ts. " +
      "Jangan ubah file test.",
    );

    expect(files).toEqual([
      "artifacts/api-server/src/services/__tests__/fixtures/autonomousRepairLiveTarget.ts",
    ]);
  });

  it("fails closed for bare filenames and unsafe traversal paths", () => {
    expect(
      extractExplicitTrustedRepairFiles(
        "Fix target.ts and ../secrets/.env and C:/temp/source.ts",
      ),
    ).toEqual([]);
  });

  it("deduplicates explicit targets and keeps the bounded order", () => {
    const path =
      "artifacts/api-server/src/services/__tests__/fixtures/autonomousRepairLiveTarget.ts";
    expect(
      extractExplicitTrustedRepairFiles(
        `Only modify ${path}. Do not modify anything else. Target again: ${path}.`,
      ),
    ).toEqual([path]);
  });
});
