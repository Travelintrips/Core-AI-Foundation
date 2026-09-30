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
  N8N_AGENT_CLIENT_ID,
  OPENCLAW_AGENT_CLIENT_ID,
  OPENHANDS_AGENT_CLIENT_ID,
  type ExternalAgentClientId,
} from "./externalAgentPolicyService.js";

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
  externalAgentClientId: ExternalAgentClientId | null;
  reason: string;
}

const MUTATING =
  /\b(fix|perbaiki|ubah|edit|patch|deploy|merge|commit|push|hapus|delete|create|buat|tambah|add|implement(?:asikan)?|refactor)\b/i;

const REPOSITORY_READONLY_CONTEXT =
  /\b(diff|pull\s*request|pr|kode|code|source|repository|repo|build|compile|test|testing|uji|ci|log|konfigurasi|config|arsitektur|architecture|typescript|javascript|python|file|module|modul)\b/i;

const AUTOMATION_EXECUTION_CONTEXT =
  /\b(n\s*8\s*n|n8n|workflow|webhook|automation|otomasi|integrasi)\b/i;

const AUTOMATION_EXECUTION_VERB =
  /\b(jalankan|run|execute|trigger|otomasi|automate|kirim|proses|sinkronkan|integrasikan|hubungkan)\b/i;

const BOUNDED_COORDINATION =
  /\b(koordinasikan|koordinasi\s+tugas|orchestrate|orchestrate\s+tasks?|delegasikan\s+tugas|bagikan\s+tugas|coordinate\s+tasks?)\b/i;

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
  const externalAgentClientId = detectExplicitExternalAgentClientId(message);

  if (infrastructureOperation) {
    return {
      kind: "INFRA_OPERATION",
      workload,
      preset: null,
      infrastructureOperation,
      externalAgentClientId: null,
      reason: "Infrastructure request is handled directly by the AI Core capability executor.",
    };
  }

  if (workload.requiresAgent) {
    return {
      kind: "CONTROL_PLANE",
      workload,
      preset: null,
      infrastructureOperation: null,
      externalAgentClientId,
      reason:
        workload.workload === "CRITICAL_ACTION"
          ? "Critical actions must enter the control plane and stop at the explicit approval gate."
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

  const value = message.trim().toLowerCase();
  if (
    AUTOMATION_EXECUTION_CONTEXT.test(value) &&
    AUTOMATION_EXECUTION_VERB.test(value)
  ) {
    return {
      kind: "EXTERNAL_AGENT",
      workload,
      preset: null,
      infrastructureOperation: null,
      externalAgentClientId: N8N_AGENT_CLIENT_ID,
      reason:
        "Workflow and webhook automation is assigned to the n8n integration automation agent.",
    };
  }

  const preset =
    workload.workload === "REVIEW"
      ? detectRemoteWorkerPreset(message)
      : null;

  if (preset && ["build", "test", "review"].includes(preset)) {
    return {
      kind: "EXTERNAL_AGENT",
      workload,
      preset,
      infrastructureOperation: null,
      externalAgentClientId: OPENHANDS_AGENT_CLIENT_ID,
      reason:
        "Repository build, test, and code-review work is assigned to the OpenHands coding agent.",
    };
  }

  if (BOUNDED_COORDINATION.test(value)) {
    return {
      kind: "EXTERNAL_AGENT",
      workload,
      preset: null,
      infrastructureOperation: null,
      externalAgentClientId: OPENCLAW_AGENT_CLIENT_ID,
      reason:
        "Bounded coordination work is assigned to the OpenClaw orchestration agent.",
    };
  }

  if (preset) {
    return {
      kind: "REMOTE_READONLY",
      workload,
      preset,
      infrastructureOperation: null,
      externalAgentClientId: null,
      reason:
        "Simple read-only repository inspection can run on the trusted remote worker.",
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

