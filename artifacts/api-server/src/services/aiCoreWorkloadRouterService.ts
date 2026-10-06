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
    .replace(/[.!?…]+$/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

const CRITICAL_ACTION =
  /\b(deploy(?:ment)?\b.{0,80}\b(?:production|prod)\b|(?:production|prod)\b.{0,40}\bdeploy(?:ment)?\b|migrasi\b.{0,40}\b(?:database|db)\b|database\s+migration|drop\s+(?:table|database)|truncate\s+(?:table|database)|hapus\s+(?:table|database)|delete\s+(?:table|database)|restart\b.{0,40}\b(?:production|prod)\b|security\s+change|ubah\s+security|rotate\s+(?:secret|key|token)|(?:ubah|edit|hapus|delete|rotate|grant|revoke)\b.{0,40}\b(?:iam|permission|role|secret|credential|billing))\b/i;

const VERIFIED_DELIVERY_WORKFLOW =
  /\b(?:merge\b.{0,40}\b(?:pr|pull\s*request)|(?:pr|pull\s*request)\b.{0,40}\bmerge|deploy\b.{0,40}\b(?:staging|stage)|(?:staging|stage)\b.{0,40}\bdeploy|commit|push)\b/i;

const AUTONOMOUS_COMPLETION_POLICY =
  /\b(?:kalau|jika|apabila|when|after|setelah)\b.{0,80}\b(?:selesai|sukses|success|verified|terverifikasi)|\b(?:tanpa|tidak perlu|no)\b.{0,40}\b(?:human|manual)\b.{0,30}\b(?:review|approval|persetujuan)|\b(?:auto|otomatis|automatically)\b.{0,40}\b(?:merge|deploy|commit|push|lanjut|continue)\b/i;

const CODING_ACTION =
  /\b(perbaiki|fix|implement(?:asikan)?|buat(?:kan)?\s+(?:kode|fitur|endpoint|api|service|komponen|component|test|unit\s+test)|tambah(?:kan)?\s+(?:kode|fitur|endpoint|api|service|komponen|component|test|unit\s+test)|refactor|ubah\s+(?:kode|source|file)|edit\s+(?:kode|source|file)|patch|commit|push)\b/i;

const CODE_CONTEXT =
  /\b(code|kode|source|repository|repo|typescript|javascript|python|function|fungsi|class|endpoint|api|build|test|ci|bug|error|workspace|task|workstream|ready[_ -]?review|siap\s+ditinjau|analyzing|menganalisis|blocked|gantung)\b/i;

const WORKSPACE_TASK_MUTATION =
  /\b(?:lanjutkan|continue|resume|selesaikan|complete|rekonsiliasi|reconcile|tutup|close|reactivate|aktifkan\s+kembali|perbaiki|fix)\b.{0,120}\b(?:workspace|task|workstream|ready[_ -]?review|siap\s+ditinjau|analyzing|menganalisis|blocked|gantung)\b|\b(?:workspace|task|workstream|ready[_ -]?review|siap\s+ditinjau|analyzing|menganalisis|blocked|gantung)\b.{0,120}\b(?:lanjutkan|continue|resume|selesaikan|complete|rekonsiliasi|reconcile|tutup|close|reactivate|perbaiki|fix)\b/i;

const REASONING =
  /\b(kenapa|mengapa|why|root\s*cause|penyebab|analisis(?:is)?|analyze|analyse|jelaskan\s+kenapa|explain\s+why|bandingkan|compare|pola|pattern|anomali|anomaly)\b/i;

const REVIEW =
  /\b(review|code\s+review|periksa|cek|audit|verifikasi|verify|validasi|inspect|build|compile|test|testing|uji)\b/i;

const REVIEW_CONTEXT =
  /\b(diff|pull\s*request|pr|kode|code|source|repository|repo|build|test|ci|log|konfigurasi|config|security|arsitektur|architecture)\b/i;

const DETERMINISTIC =
  /^(?:\/)?(?:status|health|healthz|model|routing|cost|help|biaya|bantuan|cek\s+status|cek\s+health|cek\s+model|routing\s+biaya)$/i;

const READ_ONLY_RUNTIME_INTENT =
  /\b(read[ -]?only|hanya baca|tanpa (?:mengubah|ubah|modifikasi|modify|change)|jangan (?:mengubah|ubah|modifikasi|modify|change)|cek|check|status|health|audit|inspect|periksa|lihat|show|list|verify|verifikasi|validasi)\b/i;

const RUNTIME_CONTEXT =
  /\b(runtime|production|prod|worker|ollama|gpu|gcp|google cloud|vm|vps|hostinger|ssh|docker|container|service|gateway|whatsapp|wa gateway|session|device|redis|queue|webhook|dns|deployment status|config(?:uration)? state|konfigurasi runtime|infrastructure|infra)\b/i;

const RUNTIME_MUTATION =
  /\b(fix|perbaiki|benahi|pulihkan|recover|restart|reconnect|start|stop|reload|redeploy|repair|bersihkan|clear|flush|ubah|edit|modify|change)\b/i;

const EXPLICIT_RUNTIME_ONLY =
  /\b(runtime[ -]?only|runtime saja|langsung (?:di|ke) runtime|jangan (?:route|arahkan|masuk)(?:kan)? ke (?:coding|coding orchestrator)|tanpa (?:repo|repository) (?:index|indexing|analysis|analisis)|jangan (?:analisis|analyze|index) (?:repo|repository))\b/i;

function stripNegatedMutations(text: string): string {
  return text
    .replace(/\b(?:jangan|do not|don't|without|tanpa)\s+(?:\w+\s+){0,3}(?:deploy(?:ment)?|merge|commit|push|restart|start|stop|delete|hapus|ubah|edit|modify|change|implement(?:asikan)?|patch|fix|perbaiki)\b/gi, " ")
    .replace(/\b(?:must not|tidak boleh)\s+(?:\w+\s+){0,3}(?:deploy(?:ment)?|merge|commit|push|restart|start|stop|delete|hapus|ubah|edit|modify|change|implement(?:asikan)?|patch|fix|perbaiki)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyAiCoreWorkload(message: string): AiCoreWorkloadRoute {
  const text = normalize(message);
  const actionableText = stripNegatedMutations(text);

  if (!text) return route("CHAT");
  if (/^(hello|hi|halo|hai|hey)$/.test(text)) return route("DETERMINISTIC");
  if (DETERMINISTIC.test(text)) return route("DETERMINISTIC");

  // Explicit read-only runtime inspection takes precedence when no affirmative
  // mutation remains after removing negated/exclusion clauses.
  if (
    READ_ONLY_RUNTIME_INTENT.test(text) &&
    RUNTIME_CONTEXT.test(text) &&
    !CRITICAL_ACTION.test(actionableText) &&
    !(CODING_ACTION.test(actionableText) && CODE_CONTEXT.test(actionableText))
  ) {
    return route("DETERMINISTIC");
  }

  // Runtime/infrastructure mutations must stay on the control plane. Words such
  // as "fix" or "perbaiki" must not turn Docker/Hostinger/VM/session operations
  // into repository-changing coding work merely because the message also
  // mentions a task, error, gateway, or repository as context.
  if (
    RUNTIME_CONTEXT.test(text) &&
    (RUNTIME_MUTATION.test(actionableText) || EXPLICIT_RUNTIME_ONLY.test(text)) &&
    !(
      CODING_ACTION.test(actionableText) &&
      CODE_CONTEXT.test(actionableText) &&
      !EXPLICIT_RUNTIME_ONLY.test(text)
    )
  ) {
    return route("CRITICAL_ACTION");
  }

  // A verified software-delivery workflow is coding orchestration, not itself a
  // critical production mutation. The autonomous controller still enforces CI,
  // verification and its own high-risk gates. Explicit production deploys and
  // destructive/security operations remain CRITICAL_ACTION above.
  if (
    AUTONOMOUS_COMPLETION_POLICY.test(actionableText) &&
    VERIFIED_DELIVERY_WORKFLOW.test(actionableText) &&
    !CRITICAL_ACTION.test(actionableText)
  ) {
    return route("CODING");
  }

  if (CRITICAL_ACTION.test(actionableText)) return route("CRITICAL_ACTION");
  if (WORKSPACE_TASK_MUTATION.test(actionableText)) return route("CODING");
  if (VERIFIED_DELIVERY_WORKFLOW.test(actionableText)) return route("CODING");
  if (CODING_ACTION.test(actionableText) && CODE_CONTEXT.test(actionableText)) return route("CODING");
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
