import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  primary: {
    ok: true as boolean,
    failureReason: "NO_CONFIGURED_PROVIDER_KEY",
  },
  health: {
    status: "ok" as "ok" | "disabled" | "fail",
    detail: undefined as string | undefined,
  },
  cloudFallback: {
    ok: false as boolean,
  },
}));

vi.mock("../localCodingAiProductionModelService.js", async () => {
  const actual = await vi.importActual<any>("../localCodingAiProductionModelService.js");
  return {
    ...actual,
    readProductionCodingModelConfig: vi.fn((env: NodeJS.ProcessEnv) => ({
      provider: env.AI_CODING_PROVIDER,
      model: env.AI_CODING_MODEL,
      providerAllowlist: ["openai", "ollama", "anthropic"],
      modelAllowlist: [],
      timeoutMs: 45_000,
      maxOutputTokens: 4_096,
    })),
    resolveAlternativeCloudCodingModel: vi.fn(async () => {
      if (mocks.cloudFallback.ok) {
        return {
          ok: true,
          selection: {
            provider: { slug: "anthropic" },
            model: { modelId: "claude-code", capabilities: ["code", "reasoning"] },
            timeoutMs: 45_000,
            maxOutputTokens: 4_096,
            selectionReason: "AUTO_CODING_CAPABILITY",
          },
        };
      }
      return {
        ok: false,
        reason: "NO_CODING_CAPABLE_MODEL",
        message: "no cloud fallback",
      };
    }),
    resolveProductionCodingModel: vi.fn(async (config: any) => {
      if (mocks.primary.ok) {
        return {
          ok: true,
          selection: {
            provider: { slug: config.provider },
            model: { modelId: config.model, capabilities: ["code", "reasoning"] },
            timeoutMs: config.timeoutMs,
            maxOutputTokens: config.maxOutputTokens,
            selectionReason: "EXPLICIT_PROVIDER_AND_MODEL",
          },
        };
      }
      return {
        ok: false,
        reason: mocks.primary.failureReason,
        message: "primary unavailable",
      };
    }),
  };
});

vi.mock("../ollamaLocalService.js", () => ({
  readOllamaLocalConfig: vi.fn((env: NodeJS.ProcessEnv) => ({
    enabled: true,
    required: false,
    baseUrl: "http://127.0.0.1:11434/v1",
    model: env.OLLAMA_MODEL || "qwen2.5-coder:7b",
  })),
  checkOllamaHealth: vi.fn(async (config: any) => ({
    status: mocks.health.status,
    latencyMs: 2,
    model: config.model,
    ...(mocks.health.detail ? { detail: mocks.health.detail } : {}),
  })),
}));

import {
  describePreferredCodingModelConfig,
  resolveConfiguredCodingFallbackModel,
  resolvePreferredCodingModel,
} from "../localCodingAiPreferredModelService.js";

describe("Preferred constrained coding model routing", () => {
  beforeEach(() => {
    mocks.primary.ok = true;
    mocks.primary.failureReason = "NO_CONFIGURED_PROVIDER_KEY";
    mocks.health.status = "ok";
    mocks.health.detail = undefined;
    mocks.cloudFallback.ok = false;
  });

  it("defaults to GPT-5.6 Sol primary and Ollama qwen coder fallback", () => {
    expect(
      describePreferredCodingModelConfig({} as NodeJS.ProcessEnv),
    ).toMatchObject({
      primaryProvider: "openai",
      primaryModel: "gpt-5.6-sol",
      fallbackEnabled: true,
      fallbackProvider: "ollama",
      fallbackModel: "qwen2.5-coder:7b",
      apiKeysExposed: false,
    });
  });


  it("resolves healthy Ollama as an explicit runtime fallback target", async () => {
    await expect(
      resolveConfiguredCodingFallbackModel({} as NodeJS.ProcessEnv),
    ).resolves.toMatchObject({
      ok: true,
      fallback: { provider: "ollama", model: "qwen2.5-coder:7b" },
      selection: {
        provider: {
          slug: "ollama",
          baseUrl: "http://127.0.0.1:11434/v1",
        },
        model: { modelId: "qwen2.5-coder:7b" },
      },
    });
  });

  it("refuses runtime fallback when fallback is explicitly disabled", async () => {
    await expect(
      resolveConfiguredCodingFallbackModel({
        AI_CODING_FALLBACK_ENABLED: "false",
      } as NodeJS.ProcessEnv),
    ).resolves.toMatchObject({
      ok: false,
      reason: "FALLBACK_DISABLED",
    });
  });

  it("uses primary GPT when it resolves", async () => {
    await expect(
      resolvePreferredCodingModel({} as NodeJS.ProcessEnv),
    ).resolves.toMatchObject({
      ok: true,
      route: "PRIMARY",
      selection: {
        provider: { slug: "openai" },
        model: { modelId: "gpt-5.6-sol" },
      },
      fallback: {
        provider: "ollama",
        model: "qwen2.5-coder:7b",
      },
    });
  });

  it("uses healthy loopback Ollama only when primary resolution fails", async () => {
    mocks.primary.ok = false;

    await expect(
      resolvePreferredCodingModel({} as NodeJS.ProcessEnv),
    ).resolves.toMatchObject({
      ok: true,
      route: "FALLBACK",
      primary: { provider: "openai", model: "gpt-5.6-sol" },
      fallback: { provider: "ollama", model: "qwen2.5-coder:7b" },
      selection: {
        provider: {
          slug: "ollama",
          baseUrl: "http://127.0.0.1:11434/v1",
        },
        model: { modelId: "qwen2.5-coder:7b" },
      },
    });
  });

  it("uses a configured cloud fallback when primary and local fallback are unavailable", async () => {
    mocks.primary.ok = false;
    mocks.health.status = "fail";
    mocks.health.detail = "connection refused";
    mocks.cloudFallback.ok = true;

    await expect(
      resolvePreferredCodingModel({} as NodeJS.ProcessEnv),
    ).resolves.toMatchObject({
      ok: true,
      route: "FALLBACK",
      fallback: { provider: "anthropic", model: "claude-code" },
      selection: {
        provider: { slug: "anthropic" },
        model: { modelId: "claude-code" },
      },
    });
  });

  it("fails closed when primary, local fallback, and cloud fallback are unavailable", async () => {
    mocks.primary.ok = false;
    mocks.health.status = "fail";
    mocks.health.detail = "connection refused";

    await expect(
      resolvePreferredCodingModel({} as NodeJS.ProcessEnv),
    ).resolves.toMatchObject({
      ok: false,
      reason: "LOCAL_FALLBACK_UNAVAILABLE",
      fallbackFailure: expect.stringContaining("connection refused"),
    });
  });

  it("can explicitly disable fallback", async () => {
    mocks.primary.ok = false;

    await expect(
      resolvePreferredCodingModel({
        AI_CODING_FALLBACK_ENABLED: "false",
      } as NodeJS.ProcessEnv),
    ).resolves.toMatchObject({
      ok: false,
      reason: "NO_CONFIGURED_PROVIDER_KEY",
    });
  });
});
