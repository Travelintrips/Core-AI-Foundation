import { describe, expect, it } from "vitest";
import {
  isRepositoryAnalyzerVerificationOnlyInstruction,
  repositoryAnalyzerVerificationAck,
} from "../repositoryAnalyzerVerificationOnlyService.js";

describe("read-only Repository Analyzer E2E intent", () => {
  const smoke = "Buat job TEST_ONLY E2E verifikasi Repository Analyzer, hanya analisis repository aman tanpa perubahan file, commit, merge atau deploy. ACK_ANALYZER_REMOTE_VPS_RETEST_20261010";

  it("recognizes an explicit nonmutating analyzer diagnostic", () => {
    expect(isRepositoryAnalyzerVerificationOnlyInstruction(smoke)).toBe(true);
    expect(repositoryAnalyzerVerificationAck(smoke)).toBe("ACK_ANALYZER_REMOTE_VPS_RETEST_20261010");
  });

  it("recognizes explicit English verification without any code modification", () => {
    expect(isRepositoryAnalyzerVerificationOnlyInstruction("TEST_ONLY: Repository Analyzer queue, persistence and atomic-claim verification. Analysis only. No code modifications, no branch changes, no merge, no deployment.")).toBe(true);
  });

  it("does not bypass real coding tasks or ambiguous test requests", () => {
    expect(isRepositoryAnalyzerVerificationOnlyInstruction("TEST_ONLY E2E implement feature with Repository Analyzer")).toBe(false);
    expect(isRepositoryAnalyzerVerificationOnlyInstruction("Repository Analyzer E2E tanpa perubahan file")).toBe(false);
    expect(isRepositoryAnalyzerVerificationOnlyInstruction("TEST_ONLY E2E tanpa perubahan file")).toBe(false);
    expect(repositoryAnalyzerVerificationAck("ACK_UNVERIFIED_RESULT_20261010")).toBeNull();
  });
});
