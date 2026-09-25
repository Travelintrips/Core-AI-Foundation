import {
  readProductionCodingModelConfig,
  resolveProductionCodingModel,
  type ProductionCodingModelFailure,
  type ProductionCodingModelSelection,
} from "./localCodingAiProductionModelService.js";
import { checkOllamaHealth, readOllamaLocalConfig } from "./ollamaLocalService.js";

const DEFAULT_PRIMARY_PROVIDER = "openai";
const DEFAULT_PRIMARY_MODEL = "gpt-5.6-sol";
const DEFAULT_FALLBACK_PROVIDER = "ollama";
const DEFAULT_FALLBACK_MODEL = "qwen2.5-coder:7b";

export interface PreferredCodingModelResolution {
  ok: true;
  selection: ProductionCodingModelSelection;
  route: "PRIMARY" | "FALLBACK";
  primary: { provider: string; model: string };
  fallback: { provider: string; model: string } | null;
  primaryFailure?: ProductionCodingModelFailure;
}

export interface PreferredCodingModelFailure {
  ok: false;
  reason: string;
  message: string;
  primaryFailure: ProductionCodingModelFailure;
  fallbackFailure?: string;
}

function envFalse(value: string | undefined): boolean {
  return ["0", "false", "no", "off"].includes((value ?? "").trim().toLowerCase());
}


export interface CodingFallbackResolution {
  ok: true;
  selection: ProductionCodingModelSelection;
  fallback: { provider: string; model: string };
}

export interface CodingFallbackFailure {
  ok: false;
  reason: string;
  message: string;
}

export async function resolveConfiguredCodingFallbackModel(
  env: NodeJS.ProcessEnv = process.env,
): Promise<CodingFallbackResolution | CodingFallbackFailure> {
  const base = readProductionCodingModelConfig(env);
  const fallbackEnabled = !envFalse(env["AI_CODING_FALLBACK_ENABLED"]);
  if (!fallbackEnabled) {
    return {
      ok: false,
      reason: "FALLBACK_DISABLED",
      message: "Constrained coding fallback is disabled.",
    };
  }

  const fallbackProvider = (
    env["AI_CODING_FALLBACK_PROVIDER"] || DEFAULT_FALLBACK_PROVIDER
  ).trim().toLowerCase();
  const fallbackModel = (
    env["AI_CODING_FALLBACK_MODEL"] ||
    env["OLLAMA_MODEL"] ||
    DEFAULT_FALLBACK_MODEL
  ).trim();

  if (fallbackProvider !== "ollama") {
    return {
      ok: false,
      reason: "FALLBACK_PROVIDER_UNSUPPORTED",
      message: "Only loopback Ollama is supported as constrained local fallback.",
    };
  }

  if (!base.providerAllowlist.map((value) => value.toLowerCase()).includes("ollama")) {
    return {
      ok: false,
      reason: "FALLBACK_PROVIDER_NOT_ALLOWED",
      message: "Ollama is not present in AI_CODING_PROVIDER_ALLOWLIST.",
    };
  }

  let local;
  try {
    local = readOllamaLocalConfig({
      ...env,
      AI_CODING_FALLBACK_PROVIDER: "ollama",
      AI_CODING_FALLBACK_MODEL: fallbackModel,
      OLLAMA_MODEL: fallbackModel,
    });
  } catch (error) {
    return {
      ok: false,
      reason: "LOCAL_FALLBACK_UNAVAILABLE",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (!local.enabled) {
    return {
      ok: false,
      reason: "LOCAL_FALLBACK_UNAVAILABLE",
      message: "Ollama fallback is disabled.",
    };
  }

  if (
    base.modelAllowlist.length > 0 &&
    !base.modelAllowlist.includes(local.model)
  ) {
    return {
      ok: false,
      reason: "FALLBACK_MODEL_NOT_ALLOWED",
      message: "Fallback model is not present in AI_CODING_MODEL_ALLOWLIST.",
    };
  }

  const health = await checkOllamaHealth(local);
  if (health.status !== "ok") {
    return {
      ok: false,
      reason: "LOCAL_FALLBACK_UNAVAILABLE",
      message: health.detail || "Ollama health check failed.",
    };
  }

  return {
    ok: true,
    fallback: { provider: "ollama", model: local.model },
    selection: {
      model: {
        modelId: local.model,
        maxOutputTokens: base.maxOutputTokens,
        capabilities: ["code", "reasoning", "text", "local"],
      },
      provider: {
        slug: "ollama",
        baseUrl: local.baseUrl,
      },
      timeoutMs: base.timeoutMs,
      maxOutputTokens: base.maxOutputTokens,
      selectionReason: "EXPLICIT_PROVIDER_AND_MODEL",
    },
  };
}

export async function resolvePreferredCodingModel(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PreferredCodingModelResolution | PreferredCodingModelFailure> {
  const base = readProductionCodingModelConfig(env);
  const primaryProvider = (
    env["AI_CODING_PRIMARY_PROVIDER"] ||
    base.provider ||
    DEFAULT_PRIMARY_PROVIDER
  ).trim().toLowerCase();
  const primaryModel = (
    env["AI_CODING_PRIMARY_MODEL"] ||
    base.model ||
    DEFAULT_PRIMARY_MODEL
  ).trim();

  const fallbackEnabled = !envFalse(env["AI_CODING_FALLBACK_ENABLED"]);
  const fallbackProvider = (
    env["AI_CODING_FALLBACK_PROVIDER"] || DEFAULT_FALLBACK_PROVIDER
  ).trim().toLowerCase();
  const fallbackModel = (
    env["AI_CODING_FALLBACK_MODEL"] ||
    env["OLLAMA_MODEL"] ||
    DEFAULT_FALLBACK_MODEL
  ).trim();

  const primary = await resolveProductionCodingModel({
    ...base,
    provider: primaryProvider,
    model: primaryModel,
  });

  if (primary.ok) {
    return {
      ok: true,
      selection: primary.selection,
      route: "PRIMARY",
      primary: { provider: primaryProvider, model: primaryModel },
      fallback: fallbackEnabled
        ? { provider: fallbackProvider, model: fallbackModel }
        : null,
    };
  }

  const fallbackResolution = await resolveConfiguredCodingFallbackModel(env);
  if (!fallbackResolution.ok) {
    return {
      ok: false,
      reason: fallbackResolution.reason,
      message:
        "Primary coding model is unavailable and configured fallback could not be used.",
      primaryFailure: primary,
      fallbackFailure: fallbackResolution.message,
    };
  }

  return {
    ok: true,
    route: "FALLBACK",
    primary: { provider: primaryProvider, model: primaryModel },
    fallback: fallbackResolution.fallback,
    primaryFailure: primary,
    selection: fallbackResolution.selection,
  };
}

export function describePreferredCodingModelConfig(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
  const base = readProductionCodingModelConfig(env);
  return {
    primaryProvider:
      env["AI_CODING_PRIMARY_PROVIDER"] || base.provider || DEFAULT_PRIMARY_PROVIDER,
    primaryModel:
      env["AI_CODING_PRIMARY_MODEL"] || base.model || DEFAULT_PRIMARY_MODEL,
    fallbackEnabled: !envFalse(env["AI_CODING_FALLBACK_ENABLED"]),
    fallbackProvider:
      env["AI_CODING_FALLBACK_PROVIDER"] || DEFAULT_FALLBACK_PROVIDER,
    fallbackModel:
      env["AI_CODING_FALLBACK_MODEL"] ||
      env["OLLAMA_MODEL"] ||
      DEFAULT_FALLBACK_MODEL,
    fallbackPolicy:
      "Fallback selection occurs before one-shot model privilege consumption only.",
    apiKeysExposed: false,
  };
}
