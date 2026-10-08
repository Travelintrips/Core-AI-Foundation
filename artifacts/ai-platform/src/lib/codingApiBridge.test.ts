import { describe, expect, it } from "vitest";
import { resolveCodingApiUrl } from "./codingApiBridge";

describe("coding API bridge", () => {
  it("routes API paths on coding host to the internal aicore API", () => {
    expect(
      resolveCodingApiUrl("/api/ai/coding/tasks?limit=20", "coding.cstlogistic.co.id"),
    ).toBe(
      "https://aicore.cstlogistic.co.id/api/ai/coding/tasks?limit=20",
    );
  });

  it("leaves non-API navigation on coding host untouched", () => {
    expect(
      resolveCodingApiUrl("/aicoding/workers", "coding.cstlogistic.co.id"),
    ).toBe("/aicoding/workers");
  });

  it("leaves the regular internal host untouched", () => {
    expect(
      resolveCodingApiUrl("/api/ai/coding/tasks", "aicore.cstlogistic.co.id"),
    ).toBe("/api/ai/coding/tasks");
  });
});
