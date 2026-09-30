import { getAllActiveModels, type ModelWithProvider } from "./aiModelService.js";
import { getProviderApiKey } from "./aiSecretService.js";

export type AiCoreWorkload =
  | "DETERMINISTIC"
  | "CHAT"
  | "REVIEW"
  | "REASONING"
  | "CODING"
  | "CRITICAL_ACTION";

export type AiCoreCostClass = "ZERO" | "LOW" | "MEDIUM" | "HIGH";

export interface AiCoreWorkloadRoute {
  workload: AiCoreWorkload;
  costClass: AiCoreCostClass;
  useLlm: boolean;
  requiresAgent: boolean;
  requiresApproval: boolean;
  maxOutputTokens: number;
  preferredCapabilities: string[];
  reason: string;
}

export interface AiCoreCloudModelRoute {
  model: ModelWithProvider["model"];
  provider: ModelWithProvider["provider"];
  workload: AiCoreWorkload;
  costClass: AiCoreCostClass;
  maxOutputTokens: number;
  reason: string;
}

const ROUTES: Record<AiCoreWorkload, Omit<AiCoreWorkloadRoute, "workload">> = {
  DETERMINISTIC: {
    costClass: "ZERO",
    useLlm: false,
    requiresAgent: false,
    requiresApproval: false,
    maxOutputTokens: 0,
    preferredCapabilities: [],
    reason: "Known operational lookup can be handled deterministically without an LLM.",
  },
  CHAT: {
    costClass: "LOW",
    useLlm: true,
    requiresAgent: false,
    requiresApproval: false,
    maxOutputTokens: 900,
    preferredCapabilities: ["fast", "text"],
    reason: "Normal conversation should prefer a fast low-cost text model.",
  },
  REVIEW: {
    costClass: "LOW",
    useLlm: true,
    requiresAgent: false,
    requiresApproval: false,
    maxOutputTokens: 1_400,
    preferredCapabilities: ["review", "reasoning", "text", "code"],
    reason: "Read-only review should prefer a capable low-cost reviewer.",
  },
  REASONING: {
    costClass: "MEDIUM",
    useLlm: true,
    requiresAgent: false,
    requiresApproval: false,
    maxOutputTokens: 2_400,
    preferredCapabilities: ["reasoning", "analysis", "text"],
    reason: "Root-cause analysis benefits from a stronger reasoning model.",
  },
  CODING: {
    costClass: "HIGH",
    useLlm: true,
    requiresAgent: true,
    requiresApproval: false,
    maxOutputTokens: 4_096,
    preferredCapabilities: ["code", "reasoning", "text"],
    reason: "Repository-changing coding work belongs in the Coding Orchestrator.",
  },
  CRITICAL_ACTION: {
    costClass: "ZERO",
    useLlm: false,
    requiresAgent: true,
    requiresApproval: true,
    maxOutputTokens: 0,
    preferredCapabilities: [],
    reason: "Critical production actions must use the control plane and explicit approval gate.",
  },
};

function route(workload: AiCoreWorkload): AiCoreWorkloadRoute {
  return { workload, ...ROUTES[workload] };
}

function normalize(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const CRITICAL_ACTION =
  /\b(deploy(?:ment)?\b.{0,80}\b(?:production|prod)\b|(?:production|prod)\b.{0,40}\bdeploy(?:ment)?\b|merge\b.{0,40}\b(?:pr|pull\s*request)\b|migrasi\b.{0,40}\b(?:database|db)\b|database\s+migration|drop\s+(?:table|database)|truncate\s+(?:table|database)|hapus\s+(?:table|database)|delete\s+(?:table|database)|restart\b.{0,40}\b(?:production|prod)\b|security\s+change|ubah\s+security|rotate\s+(?:secret|key|token))\b/i;

const CODING_ACTION =
  /\b(perbaiki|fix|implement(?:asikan)?|buat(?:kan)?\s+(?:kode|fitur|endpoint|api|service|komponen|component|test|unit\s+test)|tambah(?:kan)?\s+(?:kode|fitur|endpoint|api|service|komponen|component|test|unit\s+test)|refactor|ubah\s+(?:kode|source|file)|edit\s+(?:kode|source|file)|patch|commit|push)\b/i;

const CODE_CONTEXT =
  /\b(code|kode|source|repository|repo|typescript|javascript|python|function|fungsi|class|endpoint|api|build|test|ci|bug|error)\b/i;

const REASONING =
  /\b(kenapa|mengapa|why|root\s*cause|penyebab|analisis(?:is)?|analyze|analyse|jelaskan\s+kenapa|explain\s+why|bandingkan|compare|pola|pattern|anomali|anomaly)\b/i;

const REVIEW =
  /\b(review|code\s+review|periksa|cek|audit|verifikasi|verify|validasi|inspect|build|compile|test|testing|uji)\b/i;

const REVIEW_CONTEXT =
  /\b(diff|pull\s*request|pr|kode|code|source|repository|repo|build|test|ci|log|konfigurasi|config|security|arsitektur|architecture)\b/i;

const DETERMINISTIC =
  /^(?:\/)?(?:status|health|healthz|model|routing|cost|help|biaya|bantuan|cek\s+status|cek\s+health|cek\s+model|routing\s+biaya)$/i;

export function classifyAiCoreWorkload(message: string): AiCoreWorkloadRoute {
  const text = normalize(message);

  if (!text) return route("CHAT");
  if (/^(hello|hi|halo|hai|hey)$/.test(text)) return route("DETERMINISTIC");
  if (DETERMINISTIC.test(text)) return route("DETERMINISTIC");
  if (CRITICAL_ACTION.test(text)) return route("CRITICAL_ACTION");
  if (CODING_ACTION.test(text) && CODE_CONTEXT.test(text)) return route("CODING");
  if (REASONING.test(text)) return route("REASONING");
  if (REVIEW.test(text) && REVIEW_CONTEXT.test(text)) return route("REVIEW");
  return route("CHAT");
}

function capabilities(row: ModelWithProvider): string[] {
  return Array.isArray(row.model.capabilities)
    ? row.model.capabilities.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
}

function outputCost(row: ModelWithProvider): number {
  const raw = row.model.costPerOutputToken;
  const parsed =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number.parseFloat(raw)
        : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : Number.POSITIVE_INFINITY;
}

function capabilityScore(row: ModelWithProvider, preferred: string[]): number {
  const caps = capabilities(row);
  return preferred.reduce(
    (score, cap, index) =>
      score + (caps.includes(cap) ? (preferred.length - index) * 20 : 0),
    0,
  );
}

function isHealthy(row: ModelWithProvider): boolean {
  const failures = Number(row.provider.consecutiveFailures ?? 0);
  return !Number.isFinite(failures) || failures <= 0;
}

function isCloudTextProvider(row: ModelWithProvider): boolean {
  const provider = String(row.provider.slug).trim().toLowerCase();
  if (["ollama", "zerollm", "replicate"].includes(provider)) return false;
  return Boolean(getProviderApiKey(provider));
}

export async function selectCloudModelForWorkload(
  workload: AiCoreWorkload,
): Promise<AiCoreCloudModelRoute | null> {
  const policy = route(workload);
  if (!policy.useLlm || policy.requiresAgent) return null;

  const all = await getAllActiveModels();
  const candidates = all
    .filter(isCloudTextProvider)
    .filter(isHealthy)
    .map((row) => ({
      row,
      capability: capabilityScore(row, policy.preferredCapabilities),
      cost: outputCost(row),
    }))
    .filter(({ capability }) => capability > 0);

  if (candidates.length === 0) return null;

  candidates.sort((left, right) => {
    // For reasoning, capability is more important than price.
    if (workload === "REASONING") {
      if (right.capability !== left.capability) {
        return right.capability - left.capability;
      }
      if (left.cost !== right.cost) return left.cost - right.cost;
    } else {
      // For chat/review, keep quality adequate, then strongly prefer the cheaper model.
      const capabilityDelta = right.capability - left.capability;
      if (Math.abs(capabilityDelta) >= 20) return capabilityDelta;
      if (left.cost !== right.cost) return left.cost - right.cost;
      if (capabilityDelta !== 0) return capabilityDelta;
    }

    const providerDelta = String(left.row.provider.slug).localeCompare(
      String(right.row.provider.slug),
    );
    if (providerDelta !== 0) return providerDelta;
    return String(left.row.model.modelId).localeCompare(
      String(right.row.model.modelId),
    );
  });

  const selected = candidates[0];
  if (!selected) return null;

  return {
    model: selected.row.model,
    provider: selected.row.provider,
    workload,
    costClass: policy.costClass,
    maxOutputTokens: Math.min(
      policy.maxOutputTokens,
      Number(selected.row.model.maxOutputTokens ?? policy.maxOutputTokens) ||
        policy.maxOutputTokens,
    ),
    reason:
      policy.reason +
      " Selected from active healthy cloud models using capability and configured output cost.",
  };
}

export function describeAiCoreWorkloadRouting(): Record<string, unknown> {
  return {
    deterministic: {
      workload: "DETERMINISTIC",
      costClass: "ZERO",
      examples: ["status", "health", "worker status", "model", "routing"],
    },
    chat: {
      workload: "CHAT",
      costClass: "LOW",
      preferredCapabilities: ROUTES.CHAT.preferredCapabilities,
    },
    review: {
      workload: "REVIEW",
      costClass: "LOW",
      preferredCapabilities: ROUTES.REVIEW.preferredCapabilities,
    },
    reasoning: {
      workload: "REASONING",
      costClass: "MEDIUM",
      preferredCapabilities: ROUTES.REASONING.preferredCapabilities,
    },
    coding: {
      workload: "CODING",
      costClass: "HIGH",
      route: "Coding Orchestrator",
    },
    criticalAction: {
      workload: "CRITICAL_ACTION",
      costClass: "ZERO",
      route: "Control plane + explicit approval",
      llmCannotAuthorize: true,
    },
  };
}
