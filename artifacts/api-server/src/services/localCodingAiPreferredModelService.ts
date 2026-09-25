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

  if (!fallbackEnabled) {
    return {
      ok: false,
      reason: primary.reason,
      message: primary.message,
      primaryFailure: primary,
    };
  }

  if (fallbackProvider !== "ollama") {
    return {
      ok: false,
      reason: "FALLBACK_PROVIDER_UNSUPPORTED",
      message:
        "Primary coding model is unavailable and configured fallback provider is unsupported.",
      primaryFailure: primary,
      fallbackFailure: "Only loopback Ollama is supported as constrained local fallback.",
    };
  }

  if (!base.providerAllowlist.map((value) => value.toLowerCase()).includes("ollama")) {
    return {
      ok: false,
      reason: "FALLBACK_PROVIDER_NOT_ALLOWED",
      message:
        "Primary coding model is unavailable and Ollama is not present in AI_CODING_PROVIDER_ALLOWLIST.",
      primaryFailure: primary,
      fallbackFailure: "Ollama provider is not allowed.",
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
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: "LOCAL_FALLBACK_UNAVAILABLE",
      message: "Primary coding model is unavailable and Ollama fallback configuration is invalid.",
      primaryFailure: primary,
      fallbackFailure: detail,
    };
  }

  if (!local.enabled) {
    return {
      ok: false,
      reason: "LOCAL_FALLBACK_UNAVAILABLE",
      message: "Primary coding model is unavailable and Ollama fallback is disabled.",
      primaryFailure: primary,
      fallbackFailure: "Ollama is disabled.",
    };
  }

  if (
    base.modelAllowlist.length > 0 &&
    !base.modelAllowlist.includes(local.model)
  ) {
    return {
      ok: false,
      reason: "FALLBACK_MODEL_NOT_ALLOWED",
      message:
        "Primary coding model is unavailable and configured Ollama fallback model is not allowed.",
      primaryFailure: primary,
      fallbackFailure: "Fallback model is not present in AI_CODING_MODEL_ALLOWLIST.",
    };
  }

  const health = await checkOllamaHealth(local);
  if (health.status !== "ok") {
    return {
      ok: false,
      reason: "LOCAL_FALLBACK_UNAVAILABLE",
      message:
        "Primary coding model is unavailable and Ollama fallback health check failed.",
      primaryFailure: primary,
      fallbackFailure: health.detail || "Ollama health check failed.",
    };
  }

  return {
    ok: true,
    route: "FALLBACK",
    primary: { provider: primaryProvider, model: primaryModel },
    fallback: { provider: "ollama", model: local.model },
    primaryFailure: primary,
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
