import { getAllActiveModels, type ModelWithProvider } from "./aiModelService.js";
import { getProviderApiKey } from "./aiSecretService.js";
import { checkZeroLlmHealth, readZeroLlmLocalConfig } from "./zeroLlmLocalService.js";

const DEFAULT_TIMEOUT_MS = 45_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 4_096;
const MIN_OUTPUT_TOKENS = 128;
const MAX_OUTPUT_TOKENS = 8_192;

export const DEFAULT_CODING_PROVIDER_ALLOWLIST = Object.freeze([
  "openai",
  "anthropic",
  "google",
  "google-gemini",
  "gemini",
  "mistral",
  "zerollm",
  "ollama",
]);

export interface ProductionCodingModelConfig {
  provider?: string;
  model?: string;
  providerAllowlist: string[];
  modelAllowlist: string[];
  timeoutMs: number;
  maxOutputTokens: number;
}

export interface ProductionCodingModelSelection {
  model: {
    modelId: string;
    maxOutputTokens?: number | null;
    capabilities?: unknown;
  };
  provider: {
    slug: string;
    baseUrl?: string | null;
  };
  timeoutMs: number;
  maxOutputTokens: number;
  selectionReason:
    | "EXPLICIT_PROVIDER_AND_MODEL"
    | "EXPLICIT_PROVIDER"
    | "EXPLICIT_MODEL"
    | "AUTO_CODING_CAPABILITY";
}

export type ProductionCodingModelUnavailableReason =
  | "NO_ACTIVE_MODELS"
  | "NO_CONFIGURED_PROVIDER_KEY"
  | "PROVIDER_NOT_ALLOWED"
  | "MODEL_NOT_ALLOWED"
  | "EXPLICIT_PROVIDER_NOT_AVAILABLE"
  | "EXPLICIT_MODEL_NOT_AVAILABLE"
  | "NO_CODING_CAPABLE_MODEL"
  | "LOCAL_PROVIDER_UNAVAILABLE";

export interface ProductionCodingModelResolution {
  ok: true;
  selection: ProductionCodingModelSelection;
}

export interface ProductionCodingModelFailure {
  ok: false;
  reason: ProductionCodingModelUnavailableReason;
  message: string;
}

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase();
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

function parseBoundedInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function readProductionCodingModelConfig(
  env: NodeJS.ProcessEnv = process.env,
): ProductionCodingModelConfig {
  const explicitProvider = env["AI_CODING_PROVIDER"]?.trim();
  const explicitModel = env["AI_CODING_MODEL"]?.trim();
  const providerAllowlist = parseCsv(env["AI_CODING_PROVIDER_ALLOWLIST"]);
  const modelAllowlist = parseCsv(env["AI_CODING_MODEL_ALLOWLIST"]);

  return {
    ...(explicitProvider ? { provider: normalizeSlug(explicitProvider) } : {}),
    ...(explicitModel ? { model: explicitModel } : {}),
    providerAllowlist:
      providerAllowlist.length > 0
        ? providerAllowlist.map(normalizeSlug)
        : [...DEFAULT_CODING_PROVIDER_ALLOWLIST],
    modelAllowlist,
    timeoutMs: parseBoundedInt(
      env["AI_CODING_MODEL_TIMEOUT_MS"],
      DEFAULT_TIMEOUT_MS,
      MIN_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    ),
    maxOutputTokens: parseBoundedInt(
      env["AI_CODING_MAX_OUTPUT_TOKENS"],
      DEFAULT_MAX_OUTPUT_TOKENS,
      MIN_OUTPUT_TOKENS,
      MAX_OUTPUT_TOKENS,
    ),
  };
}

function modelCapabilities(row: ModelWithProvider): string[] {
  return Array.isArray(row.model.capabilities)
    ? row.model.capabilities.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
}

function modelCost(row: ModelWithProvider): number {
  const raw = row.model.costPerOutputToken;
  const parsed =
    typeof raw === "string"
      ? Number.parseFloat(raw)
      : typeof raw === "number"
        ? raw
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function codingCapabilityScore(row: ModelWithProvider): number {
  const caps = modelCapabilities(row);
  let score = 0;
  if (caps.includes("code")) score += 100;
  if (caps.includes("reasoning")) score += 30;
  if (caps.includes("text")) score += 10;
  if (caps.includes("fast")) score += 2;
  return score;
}

function isCodingCapable(row: ModelWithProvider): boolean {
  return codingCapabilityScore(row) > 0;
}

function deterministicSort(
  left: ModelWithProvider,
  right: ModelWithProvider,
): number {
  const scoreDelta = codingCapabilityScore(right) - codingCapabilityScore(left);
  if (scoreDelta !== 0) return scoreDelta;

  const costDelta = modelCost(left) - modelCost(right);
  if (costDelta !== 0) return costDelta;

  const providerDelta = String(left.provider.slug).localeCompare(
    String(right.provider.slug),
  );
  if (providerDelta !== 0) return providerDelta;

  return String(left.model.modelId).localeCompare(String(right.model.modelId));
}

function failure(
  reason: ProductionCodingModelUnavailableReason,
  message: string,
): ProductionCodingModelFailure {
  return { ok: false, reason, message };
}

export async function resolveProductionCodingModel(
  config = readProductionCodingModelConfig(),
): Promise<ProductionCodingModelResolution | ProductionCodingModelFailure> {
  if (config.provider === "zerollm") {
    if (!config.providerAllowlist.map(normalizeSlug).includes("zerollm")) {
      return failure(
        "PROVIDER_NOT_ALLOWED",
        "ZeroLLM is not present in AI_CODING_PROVIDER_ALLOWLIST.",
      );
    }

    let local;
    try {
      local = readZeroLlmLocalConfig();
    } catch (error) {
      return failure(
        "LOCAL_PROVIDER_UNAVAILABLE",
        error instanceof Error ? error.message : String(error),
      );
    }

    if (!local.enabled) {
      return failure(
        "LOCAL_PROVIDER_UNAVAILABLE",
        "ZeroLLM local provider is not enabled.",
      );
    }
    if (config.model && config.model !== local.model) {
      return failure(
        "EXPLICIT_MODEL_NOT_AVAILABLE",
        "AI_CODING_MODEL does not match the configured local ZeroLLM model.",
      );
    }
    if (
      config.modelAllowlist.length > 0 &&
      !config.modelAllowlist.includes(local.model)
    ) {
      return failure(
        "MODEL_NOT_ALLOWED",
        "Configured ZeroLLM model is not present in AI_CODING_MODEL_ALLOWLIST.",
      );
    }

    const health = await checkZeroLlmHealth(local);
    if (health.status !== "ok") {
      return failure(
        "LOCAL_PROVIDER_UNAVAILABLE",
        "ZeroLLM local provider health check failed" +
          (health.detail ? ": " + health.detail : "."),
      );
    }

    return {
      ok: true,
      selection: {
        model: {
          modelId: local.model,
          maxOutputTokens: config.maxOutputTokens,
          capabilities: ["code", "reasoning", "text", "local"],
        },
        provider: {
          slug: "zerollm",
          baseUrl: local.baseUrl,
        },
        timeoutMs: config.timeoutMs,
        maxOutputTokens: config.maxOutputTokens,
        selectionReason:
          config.model
            ? "EXPLICIT_PROVIDER_AND_MODEL"
            : "EXPLICIT_PROVIDER",
      },
    };
  }

  const allModels = await getAllActiveModels();
  if (allModels.length === 0) {
    return failure("NO_ACTIVE_MODELS", "No active AI models are registered.");
  }

  const withKeys = allModels.filter((row) =>
    Boolean(getProviderApiKey(String(row.provider.slug))),
  );
  if (withKeys.length === 0) {
    return failure(
      "NO_CONFIGURED_PROVIDER_KEY",
      "No active model has a configured backend provider API key.",
    );
  }

  const providerAllowed = new Set(config.providerAllowlist.map(normalizeSlug));
  const allowedProviders = withKeys.filter((row) =>
    providerAllowed.has(normalizeSlug(String(row.provider.slug))),
  );
  if (allowedProviders.length === 0) {
    return failure(
      "PROVIDER_NOT_ALLOWED",
      "No configured model uses a provider permitted for constrained coding.",
    );
  }

  const modelAllowed = new Set(config.modelAllowlist);
  const allowedModels =
    modelAllowed.size > 0
      ? allowedProviders.filter((row) =>
          modelAllowed.has(String(row.model.modelId)),
        )
      : allowedProviders;

  if (allowedModels.length === 0) {
    return failure(
      "MODEL_NOT_ALLOWED",
      "No configured model is present in AI_CODING_MODEL_ALLOWLIST.",
    );
  }

  let candidates = allowedModels;

  if (config.provider) {
    candidates = candidates.filter(
      (row) =>
        normalizeSlug(String(row.provider.slug)) ===
        normalizeSlug(config.provider ?? ""),
    );
    if (candidates.length === 0) {
      return failure(
        "EXPLICIT_PROVIDER_NOT_AVAILABLE",
        "AI_CODING_PROVIDER does not resolve to an active allowed provider with a configured key.",
      );
    }
  }

  if (config.model) {
    candidates = candidates.filter(
      (row) => String(row.model.modelId) === config.model,
    );
    if (candidates.length === 0) {
      return failure(
        "EXPLICIT_MODEL_NOT_AVAILABLE",
        "AI_CODING_MODEL does not resolve to an active allowed model with a configured provider key.",
      );
    }
  }

  candidates = candidates.filter(isCodingCapable);
  if (candidates.length === 0) {
    return failure(
      "NO_CODING_CAPABLE_MODEL",
      "No allowed configured model advertises code, reasoning, text, or fast capability.",
    );
  }

  candidates.sort(deterministicSort);
  const selected = candidates[0]!;
  const selectionReason =
    config.provider && config.model
      ? "EXPLICIT_PROVIDER_AND_MODEL"
      : config.provider
        ? "EXPLICIT_PROVIDER"
        : config.model
          ? "EXPLICIT_MODEL"
          : "AUTO_CODING_CAPABILITY";

  return {
    ok: true,
    selection: {
      model: selected.model,
      provider: selected.provider,
      timeoutMs: config.timeoutMs,
      maxOutputTokens: config.maxOutputTokens,
      selectionReason,
    },
  };
}

export function describeProductionCodingModelConfig(
  config = readProductionCodingModelConfig(),
): Record<string, unknown> {
  return {
    provider: config.provider ?? null,
    model: config.model ?? null,
    providerAllowlist: config.providerAllowlist,
    modelAllowlist: config.modelAllowlist,
    timeoutMs: config.timeoutMs,
    maxOutputTokens: config.maxOutputTokens,
    apiKeysExposed: false,
  };
}
