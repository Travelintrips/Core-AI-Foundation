import { describe, expect, it } from "vitest";
import { openAIModelSupportsTemperature } from "../aiExecutionService.js";

describe("openAIModelSupportsTemperature", () => {
  it("omits temperature for GPT-5 family models", () => {
    expect(openAIModelSupportsTemperature("gpt-5")).toBe(false);
    expect(openAIModelSupportsTemperature("gpt-5.6")).toBe(false);
    expect(openAIModelSupportsTemperature("gpt-5.6-sol")).toBe(false);
    expect(openAIModelSupportsTemperature("gpt-5-mini")).toBe(false);
  });

  it("omits temperature for o-series reasoning models", () => {
    expect(openAIModelSupportsTemperature("o1")).toBe(false);
    expect(openAIModelSupportsTemperature("o3-mini")).toBe(false);
  });

  it("keeps temperature for legacy chat models", () => {
    expect(openAIModelSupportsTemperature("gpt-4o")).toBe(true);
    expect(openAIModelSupportsTemperature("gpt-4.1")).toBe(true);
  });
});
