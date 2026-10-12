import { describe, expect, it } from "vitest";
import { resolveNewCodingJobBranch } from "../devFirstCodingBranchPolicy.js";

describe("DEV-first coding job branch", () => {
  it("defaults new Core AI jobs to develop", () => {
    expect(resolveNewCodingJobBranch("Travelintrips/Core-AI-Foundation", undefined)).toBe("develop");
    expect(resolveNewCodingJobBranch("Travelintrips/Core-AI-Foundation", "develop")).toBe("develop");
  });
  it("blocks explicit main and arbitrary code branches on new Core AI jobs", () => {
    for (const b of ["main", "release/production", "feat/off-main"]) {
      expect(() => resolveNewCodingJobBranch("Travelintrips/Core-AI-Foundation", b)).toThrow(/must start on develop/);
    }
  });
  it("does not override other repositories' branches", () => {
    expect(resolveNewCodingJobBranch("Travelintrips/AI-Task-Hub", "main")).toBe("main");
    expect(resolveNewCodingJobBranch("Travelintrips/AI-Task-Hub", undefined)).toBeUndefined();
  });
});
