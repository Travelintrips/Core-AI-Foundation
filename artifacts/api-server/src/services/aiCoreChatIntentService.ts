import {
  classifyAiCoreWorkload,
  type AiCoreWorkloadRoute,
} from "./aiCoreWorkloadRouterService.js";
import {
  detectAiCoreInfrastructureOperation,
  type AiCoreInfrastructureOperation,
} from "./aiCoreInfrastructureControlService.js";

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
  reason: string;
}

const MUTATING =
  /\b(fix|perbaiki|ubah|edit|patch|deploy|merge|commit|push|hapus|delete|create|buat|tambah|add|implement(?:asikan)?|refactor)\b/i;

const REPOSITORY_READONLY_CONTEXT =
  /\b(diff|pull\s*request|pr|kode|code|source|repository|repo|build|compile|test|testing|uji|ci|log|konfigurasi|config|arsitektur|architecture|typescript|javascript|python|file|module|modul)\b/i;

function isExplicitOpenClawDelegation(message: string): boolean {
  const text = message.trim().toLowerCase();
  if (!text || !/\bopen\s*claw\b|\bopenclaw\b/i.test(text)) return false;
  return /\b(gunakan|pakai|gunakanlah|jalankan|suruh|minta|delegasikan|delegate|route|rutekan|via|melalui|dengan)\b/i.test(text);
}

export function isAiCoreCapabilityQuery(message: string): boolean {
  const value = message.trim().toLowerCase();
  if (!value) return false;
  return /(?:\bkemampuan\b|\bkapabilitas\b|\bcapabilit(?:y|ies)\b|\banda\s+bisa\s+apa\b|\bapa\s+(?:saja\s+)?yang\s+(?:bisa|dapat)\s+(?:anda|kamu|ai\s+core)\b|\b(?:apakah\s+)?(?:sekarang\s+)?(?:anda|kamu|ai\s+core)?\s*(?:sudah\s+)?(?:bisa|dapat)\s+(?:langsung\s+)?(?:akses|mencari|query|membaca|melihat)\s+(?:ke\s+|di\s+|dari\s+)?(?:database|db)\b|\b(?:bisa|dapat)\s+(?:akses|query)\s+(?:database|db)\b)/i.test(value);
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
  if (/\b(test|testing|uji)\b/i.test(value)) return "test";
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

  if (infrastructureOperation) {
    return {
      kind: "INFRA_OPERATION",
      workload,
      preset: null,
      infrastructureOperation,
      reason: "Infrastructure request is handled directly by the AI Core capability executor.",
    };
  }

  if (workload.requiresAgent) {
    return {
      kind: "CONTROL_PLANE",
      workload,
      preset: null,
      infrastructureOperation: null,
      reason:
        workload.workload === "CRITICAL_ACTION"
          ? "Critical actions must enter the control plane and stop at the explicit approval gate."
          : "Repository-changing coding work must enter the Coding Orchestrator.",
    };
  }

  if (isExplicitOpenClawDelegation(message)) {
    return {
      kind: "EXTERNAL_AGENT",
      workload,
      preset: null,
      infrastructureOperation: null,
      reason:
        "Explicit OpenClaw delegation is routed to the bounded external-agent work queue controlled by AI Core.",
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
      reason:
        "Read-only repository inspection can run on the trusted remote worker without creating a coding task.",
    };
  }

  return {
    kind: "ANSWER",
    workload,
    preset: null,
    infrastructureOperation: null,
    reason:
      "This request can be answered without mutating the repository or production system.",
  };
}
