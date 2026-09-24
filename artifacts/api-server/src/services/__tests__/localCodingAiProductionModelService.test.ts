import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  models: [] as any[],
  keys: new Map<string, string>(),
}));

vi.mock("../aiModelService.js", () => ({
  getAllActiveModels: vi.fn(async () => mocks.models),
}));

vi.mock("../aiSecretService.js", () => ({
  getProviderApiKey: vi.fn((slug: string) => mocks.keys.get(slug) ?? null),
}));

import {
  DEFAULT_CODING_PROVIDER_ALLOWLIST,
  describeProductionCodingModelConfig,
  readProductionCodingModelConfig,
  resolveProductionCodingModel,
} from "../localCodingAiProductionModelService.js";

function row(
  provider: string,
  modelId: string,
  capabilities: string[],
  cost = "0.00001",
) {
  return {
    provider: {
      id: 1,
      slug: provider,
      isActive: true,
      baseUrl: null,
    },
    model: {
      id: 1,
      providerId: 1,
      modelId,
      isActive: true,
      capabilities,
      costPerOutputToken: cost,
      maxOutputTokens: 4096,
    },
  };
}

describe("Production constrained coding model resolution", () => {
  beforeEach(() => {
    mocks.models.length = 0;
    mocks.keys.clear();
  });

  it("reads bounded backend-only configuration without exposing secrets", () => {
    const env = {
      AI_CODING_PROVIDER: " OpenAI ",
      AI_CODING_MODEL: "gpt-code",
      AI_CODING_PROVIDER_ALLOWLIST: "openai,anthropic,openai",
      AI_CODING_MODEL_ALLOWLIST: "gpt-code,claude-code",
      AI_CODING_MODEL_TIMEOUT_MS: "999999",
      AI_CODING_MAX_OUTPUT_TOKENS: "999999",
    } as NodeJS.ProcessEnv;

    const config = readProductionCodingModelConfig(env);
    expect(config).toEqual({
      provider: "openai",
      model: "gpt-code",
      providerAllowlist: ["openai", "anthropic"],
      modelAllowlist: ["gpt-code", "claude-code"],
      timeoutMs: 60_000,
      maxOutputTokens: 8_192,
    });
    expect(describeProductionCodingModelConfig(config)).toMatchObject({
      apiKeysExposed: false,
    });
  });

  it("uses a conservative default provider allowlist", () => {
    const config = readProductionCodingModelConfig({} as NodeJS.ProcessEnv);
    expect(config.providerAllowlist).toEqual([
      ...DEFAULT_CODING_PROVIDER_ALLOWLIST,
    ]);
    expect(config.timeoutMs).toBe(45_000);
    expect(config.maxOutputTokens).toBe(4_096);
  });

  it("selects an explicitly configured provider and model only when key and capability are present", async () => {
    mocks.models.push(
      row("openai", "gpt-code", ["code", "reasoning"]),
      row("anthropic", "claude-code", ["code"]),
    );
    mocks.keys.set("openai", "secret");
    mocks.keys.set("anthropic", "secret");

    const result = await resolveProductionCodingModel({
      provider: "openai",
      model: "gpt-code",
      providerAllowlist: ["openai", "anthropic"],
      modelAllowlist: ["gpt-code", "claude-code"],
      timeoutMs: 10_000,
      maxOutputTokens: 1_024,
    });

    expect(result).toMatchObject({
      ok: true,
      selection: {
        provider: { slug: "openai" },
        model: { modelId: "gpt-code" },
        timeoutMs: 10_000,
        maxOutputTokens: 1_024,
        selectionReason: "EXPLICIT_PROVIDER_AND_MODEL",
      },
    });
  });

  it("deterministically prefers stronger coding capability before cost", async () => {
    mocks.models.push(
      row("openai", "cheap-text", ["text"], "0.000001"),
      row("anthropic", "code-model", ["code"], "0.1"),
    );
    mocks.keys.set("openai", "secret");
    mocks.keys.set("anthropic", "secret");

    const result = await resolveProductionCodingModel({
      providerAllowlist: ["openai", "anthropic"],
      modelAllowlist: [],
      timeoutMs: 45_000,
      maxOutputTokens: 4_096,
    });

    expect(result).toMatchObject({
      ok: true,
      selection: {
        provider: { slug: "anthropic" },
        model: { modelId: "code-model" },
        selectionReason: "AUTO_CODING_CAPABILITY",
      },
    });
  });

  it("fails closed when provider API keys are unavailable", async () => {
    mocks.models.push(row("openai", "gpt-code", ["code"]));

    await expect(resolveProductionCodingModel()).resolves.toMatchObject({
      ok: false,
      reason: "NO_CONFIGURED_PROVIDER_KEY",
    });
  });

  it("fails closed when an explicit provider or model is unavailable", async () => {
    mocks.models.push(row("openai", "gpt-code", ["code"]));
    mocks.keys.set("openai", "secret");

    await expect(
      resolveProductionCodingModel({
        provider: "anthropic",
        providerAllowlist: ["openai", "anthropic"],
        modelAllowlist: [],
        timeoutMs: 45_000,
        maxOutputTokens: 4_096,
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "EXPLICIT_PROVIDER_NOT_AVAILABLE",
    });

    await expect(
      resolveProductionCodingModel({
        model: "missing-model",
        providerAllowlist: ["openai"],
        modelAllowlist: [],
        timeoutMs: 45_000,
        maxOutputTokens: 4_096,
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "EXPLICIT_MODEL_NOT_AVAILABLE",
    });
  });

  it("rejects providers and models outside configured allowlists", async () => {
    mocks.models.push(row("openai", "gpt-code", ["code"]));
    mocks.keys.set("openai", "secret");

    await expect(
      resolveProductionCodingModel({
        providerAllowlist: ["anthropic"],
        modelAllowlist: [],
        timeoutMs: 45_000,
        maxOutputTokens: 4_096,
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "PROVIDER_NOT_ALLOWED",
    });

    await expect(
      resolveProductionCodingModel({
        providerAllowlist: ["openai"],
        modelAllowlist: ["other-model"],
        timeoutMs: 45_000,
        maxOutputTokens: 4_096,
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "MODEL_NOT_ALLOWED",
    });
  });

  it("requires an explicit coding-compatible capability", async () => {
    mocks.models.push(row("openai", "image-only", ["image-generation"]));
    mocks.keys.set("openai", "secret");

    await expect(resolveProductionCodingModel()).resolves.toMatchObject({
      ok: false,
      reason: "NO_CODING_CAPABLE_MODEL",
    });
  });
});
