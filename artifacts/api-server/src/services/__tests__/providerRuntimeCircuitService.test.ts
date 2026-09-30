import { describe, expect, it } from "vitest";
import {
  classifyProviderRuntimeFailure,
  getActiveProviderRuntimeCircuit,
} from "../providerRuntimeCircuitService.js";

describe("provider runtime circuit", () => {
  it("classifies runtime failures that should temporarily remove a provider from routing", () => {
    expect(
      classifyProviderRuntimeFailure(
        new Error("Gemini authentication failed. Check the configured API key."),
      ),
    ).toBe("AUTH");
    expect(
      classifyProviderRuntimeFailure(
        new Error("OpenAI rate limit or quota exceeded. Check the provider account."),
      ),
    ).toBe("RATE_LIMIT");
    expect(
      classifyProviderRuntimeFailure(new Error("provider unavailable HTTP 503")),
    ).toBe("UNAVAILABLE");
    expect(classifyProviderRuntimeFailure(new Error("bad json output"))).toBeNull();
  });

  it("returns only unexpired runtime circuits", () => {
    const now = Date.parse("2026-09-30T11:00:00.000Z");
    const active = {
      runtimeCircuit: {
        reason: "AUTH",
        openedAt: "2026-09-30T10:59:00.000Z",
        openUntil: "2026-09-30T11:15:00.000Z",
        lastError: "authentication failed",
      },
    };
    expect(getActiveProviderRuntimeCircuit(active, now)).toMatchObject({
      reason: "AUTH",
    });
    expect(
      getActiveProviderRuntimeCircuit(
        {
          runtimeCircuit: {
            ...active.runtimeCircuit,
            openUntil: "2026-09-30T10:59:59.000Z",
          },
        },
        now,
      ),
    ).toBeNull();
  });
});
