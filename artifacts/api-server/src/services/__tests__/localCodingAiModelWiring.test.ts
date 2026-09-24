import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
}));

vi.mock("../localCodingAiProductionModelService.js", () => ({
  resolveProductionCodingModel: mocks.resolve,
}));

import {
  LocalCodingAiExecutionGateError,
  resolveConstrainedCodingModelSelection,
} from "../localCodingAiExecutionGateService.js";

describe("constrained coding production model wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the production resolver selection including bounded execution limits", async () => {
    mocks.resolve.mockResolvedValue({
      ok: true,
      selection: {
        provider: {
          id: 1,
          slug: "openai",
          baseUrl: null,
          isActive: true,
        },
        model: {
          id: 2,
          modelId: "gpt-code",
          providerId: 1,
          isActive: true,
          capabilities: ["code"],
        },
        timeoutMs: 12_000,
        maxOutputTokens: 2_048,
        selectionReason: "EXPLICIT_PROVIDER_AND_MODEL",
      },
    });

    await expect(resolveConstrainedCodingModelSelection()).resolves.toMatchObject({
      provider: { slug: "openai" },
      model: { modelId: "gpt-code" },
      timeoutMs: 12_000,
      maxOutputTokens: 2_048,
      selectionReason: "EXPLICIT_PROVIDER_AND_MODEL",
    });
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
  });

  it("maps resolver failure to fail-closed MODEL_UNAVAILABLE", async () => {
    mocks.resolve.mockResolvedValue({
      ok: false,
      reason: "MODEL_NOT_ALLOWED",
      message: "No configured model is present in AI_CODING_MODEL_ALLOWLIST.",
    });

    await expect(resolveConstrainedCodingModelSelection()).rejects.toMatchObject({
      name: "LocalCodingAiExecutionGateError",
      kind: "MODEL_UNAVAILABLE",
      details: { reason: "MODEL_NOT_ALLOWED" },
    } satisfies Partial<LocalCodingAiExecutionGateError>);
  });
});
