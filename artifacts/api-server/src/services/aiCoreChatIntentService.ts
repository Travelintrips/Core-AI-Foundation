import {
  classifyAiCoreWorkload,
  type AiCoreWorkloadRoute,
} from "./aiCoreWorkloadRouterService.js";
import {
  detectAiCoreInfrastructureOperation,
  type AiCoreInfrastructureOperation,
} from "./aiCoreInfrastructureControlService.js";
import {
  detectExplicitExternalAgentClientId,
} from "./externalAgentDispatchService.js";

export const DEFAULT_AI_CORE_CHAT_MODE = "auto" as const;

export type AiCoreChatMode = "auto" | "ask" | "agent";
export type AiCoreChatDispatchKind =
  | "ANSWER"
  | "REMOTE_READONLY"
  | "INFRA_OPERATION"
  | "EXTERNAL_AGENT"
  | "CONTROL_PLANE";
export type RemoteWorkerPreset = "check" | "build" | "test" | "review";

export interface AiCoreChatDispatchDecision {
  kind: AiCoreChatDispatchKind;
  workload: AiCoreWorkloadRoute;
  preset: RemoteWorkerPreset | null;
  infrastructureOperation: AiCoreInfrastructureOperation | null;
  externalAgentClientId: string | null;
  reason: string;
}

const MUTATING =
  /\b(fix|perbaiki|ubah|edit|patch|deploy|merge|commit|push|hapus|delete|create|buat|tambah|add|implement(?:asikan)?|refactor)\b/i;

const REPOSITORY_READONLY_CONTEXT =
  /\b(diff|pull\s*request|pr|kode|code|source|repository|repo|build|compile|test|testing|uji|ci|log|konfigurasi|config|arsitektur|architecture|typescript|javascript|python|file|module|modul)\b/i;

export function isAiCoreCapabilityQuery(message: string): boolean {
  const value = message.trim().toLowerCase();
  if (!value) return false;
  return /(?:\bkemampuan\b|\bkapabilitas\b|\bcapabilit(?:y|ies)\b|\banda\s+bisa\s+apa\b|\bapa\s+(?:saja\s+)?yang\s+(?:bisa|dapat)\s+(?:anda|kamu|ai\s+core)\b|\b(?:apakah\s+)?(?:sekarang\s+)?(?:anda|kamu|ai\s+core)?\s*(?:sudah\s+)?(?:bisa|dapat)\s+(?:langsung\s+)?(?:akses|mencari|query|membaca|melihat)\s+(?:ke\s+|di\s+|dari\s+)?(?:database|db)\b|\b(?:bisa|dapat)\s+(?:akses|query)\s+(?:database|db)\b|\b(?:agent(?:\s+ai)?|worker|model|provider)\s+(?:apa(?:\s+saja)?|mana|yang\s+mana)\s+(?:yang\s+)?(?:sudah\s+)?(?:terpasang|terinstall|terinstal|installed|aktif|online|tersedia)\b|\b(?:apa(?:\s+saja)?|daftar|list)\s+(?:agent(?:\s+ai)?|worker|model|provider)\s+(?:yang\s+)?(?:sudah\s+)?(?:terpasang|terinstall|terinstal|installed|aktif|online|tersedia)\b)/i.test(value);
}

export function detectRemoteWorkerPreset(
  message: string,
): RemoteWorkerPreset | null {
  const value = message.trim().toLowerCase();
  if (!value || MUTATING.test(value)) return null;

  if (/\b(review|tinjau|audit\s+diff|cek\s+diff)\b/i.test(value)) {
    return REPOSITORY_READONLY_CONTEXT.test(value) ? "review" : null;
  }
  if (/\b(build|compile)\b/i.test(value)) return "build";
  if (/\b(test|testing|uji)\b/i.test(value)) {
    // Connectivity checks must not silently execute the repository's test suite.
    const connectivity = /\b(koneksi|connection|connectivity|dua\s+arah|two[ -]way|ping|echo)\b/i.test(value);
    const explicitSuite = /\b(?:jalankan|run|execute)\s+(?:(?:unit|integration|api|repository|repo)\s+)?tests?\b|\b(?:unit|integration|integrasi|api|repository|repo)\s+tests?\b|\btests?\s+(?:suite|api|repository|repo)\b/i.test(value);
    return connectivity && !explicitSuite ? null : "test";
  }
  if (/\b(cek|check|verify|verifikasi|validasi|status\s+repository|status\s+repo|periksa|inspect)\b/i.test(value)) {
    return REPOSITORY_READONLY_CONTEXT.test(value) ? "check" : null;
  }
  return null;
}

export function classifyAiCoreChatDispatch(
  message: string,
): AiCoreChatDispatchDecision {
  const workload = classifyAiCoreWorkload(message);
  const infrastructureOperation = detectAiCoreInfrastructureOperation(message);
  const externalAgentClientId = detectExplicitExternalAgentClientId(message);

  // A concrete infrastructure capability bypasses repository analysis unless
  // the message is actually asking to change repository code and merely mentions
  // infrastructure as context/example. Direct operational mutations still use
  // the infrastructure executor, which owns its mutation/approval policy.
  if (
    infrastructureOperation &&
    workload.workload !== "CODING"
  ) {
    return {
      kind: "INFRA_OPERATION",
      workload,
      preset: null,
      infrastructureOperation,
      externalAgentClientId: null,
      reason:
        "Concrete infrastructure capability is executed directly without repository indexing or Coding Orchestrator analysis.",
    };
  }

  // Repository-changing and other critical actions without a concrete
  // infrastructure executor continue through the controlled agent path.
  if (workload.requiresAgent) {
    return {
      kind: "CONTROL_PLANE",
      workload,
      preset: null,
      infrastructureOperation: null,
      externalAgentClientId,
      reason:
        workload.workload === "CRITICAL_ACTION"
          ? "Critical action has no direct infrastructure executor and must enter the control plane."
          : "Repository-changing coding work must enter the Coding Orchestrator; an explicitly named coding agent may be used only inside that controlled path.",
    };
  }

  if (externalAgentClientId) {
    return {
      kind: "EXTERNAL_AGENT",
      workload,
      preset: null,
      infrastructureOperation: null,
      externalAgentClientId,
      reason:
        "Explicit external-agent delegation is routed to the role-scoped work queue controlled by AI Core.",
    };
  }

  const preset =
    workload.workload === "REVIEW"
      ? detectRemoteWorkerPreset(message)
      : null;

  if (preset) {
    return {
      kind: "REMOTE_READONLY",
      workload,
      preset,
      infrastructureOperation: null,
      externalAgentClientId: null,
      reason:
        "Read-only repository inspection can run on the trusted remote worker without creating a coding task.",
    };
  }

  return {
    kind: "ANSWER",
    workload,
    preset: null,
    infrastructureOperation: null,
    externalAgentClientId: null,
    reason:
      "This request can be answered without mutating the repository or production system.",
  };
}

