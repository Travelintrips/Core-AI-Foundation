import { describe, expect, it } from "vitest";
import {
  anthropicModelSupportsTemperature,
  openAIModelSupportsTemperature,
} from "../aiExecutionService.js";

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


describe("anthropicModelSupportsTemperature", () => {
  it("omits deprecated temperature for Claude 4.7+ and Mythos models", () => {
    expect(anthropicModelSupportsTemperature("claude-opus-4-7")).toBe(false);
    expect(anthropicModelSupportsTemperature("claude-opus-4-8")).toBe(false);
    expect(anthropicModelSupportsTemperature("claude-sonnet-5")).toBe(false);
    expect(anthropicModelSupportsTemperature("claude-mythos-preview")).toBe(false);
  });

  it("keeps temperature for older compatible Claude models", () => {
    expect(anthropicModelSupportsTemperature("claude-sonnet-4-6")).toBe(true);
    expect(anthropicModelSupportsTemperature("claude-haiku-4-5-20251001")).toBe(true);
  });
});
