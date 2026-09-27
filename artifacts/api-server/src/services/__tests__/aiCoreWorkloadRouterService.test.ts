import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  models: [] as any[],
  keys: new Set<string>(),
}));

vi.mock("../aiModelService.js", () => ({
  getAllActiveModels: vi.fn(async () => mocks.models),
}));

vi.mock("../aiSecretService.js", () => ({
  getProviderApiKey: vi.fn((slug: string) =>
    mocks.keys.has(slug.toLowerCase()) ? "configured" : null,
  ),
}));

import {
  classifyAiCoreWorkload,
  selectCloudModelForWorkload,
} from "../aiCoreWorkloadRouterService.js";

function row(input: {
  provider: string;
  model: string;
  capabilities: string[];
  cost: string;
  failures?: number;
}) {
  return {
    provider: {
      slug: input.provider,
      consecutiveFailures: input.failures ?? 0,
    },
    model: {
      modelId: input.model,
      capabilities: input.capabilities,
      costPerOutputToken: input.cost,
      maxOutputTokens: 4096,
    },
  };
}

describe("AI Core workload router", () => {
  beforeEach(() => {
    mocks.models = [];
    mocks.keys = new Set();
  });

  it("routes operational status to deterministic zero-token execution", () => {
    expect(classifyAiCoreWorkload("cek status")).toMatchObject({
      workload: "DETERMINISTIC",
      costClass: "ZERO",
      useLlm: false,
    });
  });

  it("routes production deploy to the explicit approval gate", () => {
    expect(classifyAiCoreWorkload("deploy ke production sekarang")).toMatchObject({
      workload: "CRITICAL_ACTION",
      costClass: "ZERO",
      requiresAgent: true,
      requiresApproval: true,
    });
  });

  it("routes repository-changing instructions to the Coding Orchestrator", () => {
    expect(classifyAiCoreWorkload("perbaiki error build di repository ini")).toMatchObject({
      workload: "CODING",
      costClass: "HIGH",
      requiresAgent: true,
    });
  });

  it("routes read-only code inspection to low-cost review", () => {
    expect(classifyAiCoreWorkload("review diff PR ini")).toMatchObject({
      workload: "REVIEW",
      costClass: "LOW",
      requiresAgent: false,
    });
  });

  it("routes root-cause questions to reasoning", () => {
    expect(classifyAiCoreWorkload("kenapa pembayaran ini tidak cocok?")).toMatchObject({
      workload: "REASONING",
      costClass: "MEDIUM",
    });
  });

  it("routes ordinary conversation to low-cost chat", () => {
    expect(classifyAiCoreWorkload("tolong jelaskan apa itu webhook")).toMatchObject({
      workload: "CHAT",
      costClass: "LOW",
    });
  });

  it("prefers the cheaper adequate model for ordinary chat across providers", async () => {
    mocks.keys = new Set(["openai", "anthropic", "gemini"]);
    mocks.models = [
      row({
        provider: "openai",
        model: "strong-expensive",
        capabilities: ["fast", "text", "reasoning"],
        cost: "0.000020",
      }),
      row({
        provider: "anthropic",
        model: "cheap-chat",
        capabilities: ["fast", "text"],
        cost: "0.000002",
      }),
      row({
        provider: "gemini",
        model: "mid-chat",
        capabilities: ["fast", "text"],
        cost: "0.000004",
      }),
    ];

    await expect(selectCloudModelForWorkload("CHAT")).resolves.toMatchObject({
      provider: { slug: "anthropic" },
      model: { modelId: "cheap-chat" },
      costClass: "LOW",
    });
  });

  it("prefers stronger reasoning capability before price for hard reasoning", async () => {
    mocks.keys = new Set(["openai", "anthropic"]);
    mocks.models = [
      row({
        provider: "openai",
        model: "reasoner",
        capabilities: ["reasoning", "analysis", "text"],
        cost: "0.000020",
      }),
      row({
        provider: "anthropic",
        model: "cheap-text",
        capabilities: ["text"],
        cost: "0.000001",
      }),
    ];

    await expect(selectCloudModelForWorkload("REASONING")).resolves.toMatchObject({
      provider: { slug: "openai" },
      model: { modelId: "reasoner" },
      costClass: "MEDIUM",
    });
  });

  it("ignores local, unconfigured, and unhealthy cloud providers", async () => {
    mocks.keys = new Set(["openai", "anthropic"]);
    mocks.models = [
      row({
        provider: "ollama",
        model: "local",
        capabilities: ["fast", "text"],
        cost: "0",
      }),
      row({
        provider: "openai",
        model: "unhealthy",
        capabilities: ["fast", "text"],
        cost: "0.000001",
        failures: 2,
      }),
      row({
        provider: "anthropic",
        model: "healthy",
        capabilities: ["fast", "text"],
        cost: "0.000005",
      }),
      row({
        provider: "gemini",
        model: "missing-key",
        capabilities: ["fast", "text"],
        cost: "0.0000001",
      }),
    ];

    await expect(selectCloudModelForWorkload("CHAT")).resolves.toMatchObject({
      provider: { slug: "anthropic" },
      model: { modelId: "healthy" },
    });
  });
});
