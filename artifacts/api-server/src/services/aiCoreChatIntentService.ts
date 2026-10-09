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
  OPENCLAW_AGENT_CLIENT_ID,
} from "./externalAgentDispatchService.js";
import {
  detectAiCoreGitHubOperation,
  type AiCoreGitHubOperation,
} from "./aiCoreGitHubControlService.js";

export const DEFAULT_AI_CORE_CHAT_MODE = "auto" as const;

export type AiCoreChatMode = "auto" | "ask" | "agent";
export type AiCoreChatDispatchKind =
  | "ANSWER"
  | "REMOTE_READONLY"
  | "INFRA_OPERATION"
  | "GITHUB_OPERATION"
  | "EXTERNAL_AGENT"
  | "GITHUB_DIRECT_REQUIRED"
  | "CONTROL_PLANE";
export type RemoteWorkerPreset = "check" | "build" | "test" | "review";

export interface AiCoreChatDispatchDecision {
  kind: AiCoreChatDispatchKind;
  workload: AiCoreWorkloadRoute;
  preset: RemoteWorkerPreset | null;
  infrastructureOperation: AiCoreInfrastructureOperation | null;
  githubOperation: AiCoreGitHubOperation | null;
  externalAgentClientId: string | null;
  executionLane: "NO_WORKER" | "TARGETED" | "CODING" | "HEAVY";
  reason: string;
}

const MUTATING =
  /\b(fix|perbaiki|ubah|edit|patch|deploy|merge|commit|push|hapus|delete|create|buat|tambah|add|implement(?:asikan)?|refactor)\b/i;

const DIRECT_OPENCLAW_PC_PREFIX = /^#\s*/;

const SAFE_DIRECT_PC_ACTION =
  /^(?:buka|open|fokus(?:kan)?|focus|klik|click|ketik|type|tulis|write|scroll|gulir|screenshot|ambil\s+screenshot|capture\s+(?:the\s+)?screen|tekan\s+(?:enter|tab|escape|esc)|press\s+(?:enter|tab|escape|esc))\b/i;

const SENSITIVE_DIRECT_PC_ACTION =
  /\b(?:hapus|delete|remove|uninstall|install|download|unggah|upload|bayar|payment|purchase|beli|transfer|password|kata\s+sandi|credential|secret|token|api\s*key|security|keamanan|powershell|cmd|terminal|shell|registry|regedit|format|shutdown|restart|reboot|kill|terminate|deploy|merge|commit|push|database|sql|ssh|rdp)\b/i;

export function parseDirectOpenClawPcCommand(message: string): string | null {
  const value = message.trim().replace(/^@\s*/, "");
  if (!DIRECT_OPENCLAW_PC_PREFIX.test(value)) return null;
  const instruction = value.replace(DIRECT_OPENCLAW_PC_PREFIX, "").trim();
  return instruction.length > 0 ? instruction : null;
}

export function isSafeDirectOpenClawPcCommand(message: string): boolean {
  const instruction = parseDirectOpenClawPcCommand(message);
  if (!instruction) return false;
  return SAFE_DIRECT_PC_ACTION.test(instruction) && !SENSITIVE_DIRECT_PC_ACTION.test(instruction);
}

const REPOSITORY_READONLY_CONTEXT =
  /\b(diff|pull\s*request|pr|kode|code|source|repository|repo|build|compile|test|testing|uji|ci|log|konfigurasi|config|arsitektur|architecture|typescript|javascript|python|file|module|modul)\b/i;

const EXPLICIT_SOURCE_CHANGE =
  /\b(?:fix|perbaiki|ubah|edit|patch|implement(?:asikan)?|refactor|tambah(?:kan)?|hapus)\b.{0,120}\b(?:kode|code|source|repository|repo|file|function|fungsi|class|module|modul|typescript|javascript|python|routing|intent|logic|alur|behavior|behaviour|bug|fitur|feature|api|endpoint|service|test|tests|regression)\b|\b(?:kode|code|source|repository|repo|file|function|fungsi|class|module|modul|routing|intent|logic|alur|behavior|behaviour|bug|fitur|feature|api|endpoint|service|test|tests|regression)\b.{0,120}\b(?:fix|perbaiki|ubah|edit|patch|implement(?:asikan)?|refactor|tambah(?:kan)?|hapus)\b/i;

const NEGATED_SOURCE_CHANGE_CLAUSE =
  /\b(?:jangan|tanpa|do\s+not|don't|without)\b[^.!?;\n]{0,180}/gi;

const CONDITIONAL_SOURCE_CHANGE_CLAUSE =
  /\b(?:hanya|only)\s+(?:jika|kalau|apabila|if)\b[^.!?;\n]{0,220}\b(?:ubah|edit|patch|fix|perbaiki|implement(?:asikan)?|refactor|tambah(?:kan)?|hapus)\b[^.!?;\n]{0,160}\b(?:kode|code|source|repository|repo|file|function|fungsi|class|module|modul|routing|intent|logic|alur|behavior|behaviour|bug|fitur|feature|api|endpoint|service|test|tests|regression)\b/gi;

export function isExplicitCodingOrchestratorRequest(message: string): boolean {
  const value = message.trim().toLowerCase();
  if (!value) return false;
  return /\b(?:coding\s+orchestrator|orchestrator\s+coding|gunakan\s+(?:coding\s+)?orchestrator|pakai\s+(?:coding\s+)?orchestrator|route\s+ke\s+coding\s+orchestrator|masuk(?:kan)?\s+ke\s+coding\s+orchestrator)\b/i.test(value);
}

export function hasExplicitSourceChange(message: string): boolean {
  // A conditional fallback such as "inspect runtime; only if logs prove a code
  // bug, patch the repo" must start in the bounded infrastructure lane. The
  // source mutation becomes actionable only after runtime evidence exists.
  const affirmativeText = message
    .replace(NEGATED_SOURCE_CHANGE_CLAUSE, " ")
    .replace(CONDITIONAL_SOURCE_CHANGE_CLAUSE, " ");
  return EXPLICIT_SOURCE_CHANGE.test(affirmativeText);
}

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
  const directOpenClawPcCommand = parseDirectOpenClawPcCommand(message);
  const workload = classifyAiCoreWorkload(directOpenClawPcCommand ?? message);

  // A leading # is an explicit operator route to the paired PC through
  // OpenClaw. It outranks coding/infra heuristics so desktop actions cannot
  // accidentally create Coding Orchestrator work.
  if (directOpenClawPcCommand) {
    return {
      kind: "EXTERNAL_AGENT",
      workload,
      preset: null,
      infrastructureOperation: null,
      githubOperation: null,
      externalAgentClientId: OPENCLAW_AGENT_CLIENT_ID,
      executionLane: "TARGETED",
      reason:
        "Leading # explicitly routes this command to the paired PC through OpenClaw without Coding Orchestrator.",
    };
  }
  // Explicit test-only job creation is an orchestration request, not a chat
  // answer or a source mutation. Never simulate its ACK with a local echo.
  const explicitTestOnlyCodingJob =
    /\\b(?:buat|create|jalankan|run)\\s+(?:sebuah\\s+)?job\\s+coding\\b/i.test(message) &&
    /\\bTEST_ONLY\\b/i.test(message) &&
    /\\b(?:routing|orchestrator|chatgpt|openclaw)\\b/i.test(message);
  if (explicitTestOnlyCodingJob) {
    return {
      kind: "CONTROL_PLANE",
      workload: { ...workload, workload: "CODING", requiresAgent: true },
      preset: null,
      infrastructureOperation: null,
      githubOperation: null,
      externalAgentClientId: null,
      executionLane: "CODING",
      reason: "Explicit TEST_ONLY coding job must enter the control plane; an ACK requires a verified external round trip.",
    };
  }
  const infrastructureOperation = detectAiCoreInfrastructureOperation(message);
  const githubOperation = detectAiCoreGitHubOperation(message);
  const externalAgentClientId = detectExplicitExternalAgentClientId(message);
  const sourceChange = hasExplicitSourceChange(message);

  // Safe explicit delegation wins over generic registry status queries.
  // Source changes and sensitive actions continue through their gated routes.
  if (externalAgentClientId && !sourceChange &&
      /\b(delegasikan|delegate|suruh|minta|route|rutekan)\b/i.test(message) &&
      !/\b(deploy|merge|restart|reboot|hapus|delete|uninstall|install|push|commit)\b/i.test(message)) {
    return {
      kind: "EXTERNAL_AGENT", workload, preset: null,
      infrastructureOperation: null, githubOperation: null,
      externalAgentClientId, executionLane: "TARGETED",
      reason: "Explicit safe delegation takes precedence over agent status inspection.",
    };
  }
  const explicitCodingOrchestrator = isExplicitCodingOrchestratorRequest(message);

  // Source-code mutation is GitHub-direct by default. This is intentionally
  // fail-closed: no repository-changing request may silently create a Coding
  // Orchestrator task. The orchestrator is reachable only when explicitly
  // requested by name.
  if (sourceChange && !explicitCodingOrchestrator) {
    return {
      kind: "GITHUB_DIRECT_REQUIRED",
      workload,
      preset: null,
      infrastructureOperation: null,
      githubOperation: null,
      externalAgentClientId: null,
      executionLane: "NO_WORKER",
      reason:
        "Repository-changing coding from ChatGPT/operator defaults to direct GitHub delivery. Coding Orchestrator requires an explicit request by name.",
    };
  }

  // Explicit, structured operational actions outrank generic CRITICAL_ACTION
  // classification. They execute in the deterministic control plane and must
  // not create repository-analysis/coding jobs. Source-code mutation still
  // outranks incidental infrastructure/GitHub examples.
  //
  // Specific Hostinger/GCP control-plane operations must win over the generic
  // coding-domain recovery heuristic. The only intentional exception is the
  // historical coding-domain recovery case where the infrastructure detector
  // sees only HOSTINGER_VPS_STATUS; that request should still trigger the
  // GitHub Hostinger deploy lane.
  const githubRecoveryOutranksGenericHostingerStatus =
    githubOperation === "GITHUB_HOSTINGER_NODEJS_DEPLOY" &&
    (infrastructureOperation === "HOSTINGER_VPS_STATUS" ||
      infrastructureOperation === "HOSTINGER_CODING_STATIC_DEPLOY");

  if (
    infrastructureOperation &&
    !sourceChange &&
    !githubRecoveryOutranksGenericHostingerStatus
  ) {
    return {
      kind: "INFRA_OPERATION",
      workload,
      preset: null,
      infrastructureOperation,
      githubOperation: null,
      externalAgentClientId: null,
      executionLane: "NO_WORKER",
      reason:
        "Explicit infrastructure action is bounded to its target system and executes directly without Repository Analyzer or coding workers.",
    };
  }

  if (githubOperation && !sourceChange) {
    return {
      kind: "GITHUB_OPERATION",
      workload,
      preset: null,
      infrastructureOperation: null,
      githubOperation,
      externalAgentClientId: null,
      executionLane: "NO_WORKER",
      reason:
        "Explicit GitHub status/rerun/cancel/verified-merge/Hostinger-deploy action executes directly without Repository Analyzer or coding workers.",
    };
  }

  if (infrastructureOperation && !sourceChange) {
    return {
      kind: "INFRA_OPERATION",
      workload,
      preset: null,
      infrastructureOperation,
      githubOperation: null,
      externalAgentClientId: null,
      executionLane: "NO_WORKER",
      reason:
        "Explicit infrastructure action is bounded to its target system and executes directly without Repository Analyzer or coding workers.",
    };
  }

  if (workload.workload === "CODING" && !explicitCodingOrchestrator) {
    return {
      kind: "GITHUB_DIRECT_REQUIRED",
      workload,
      preset: null,
      infrastructureOperation: null,
      githubOperation: null,
      externalAgentClientId: null,
      executionLane: "NO_WORKER",
      reason:
        "Coding work defaults to direct GitHub delivery. Coding Orchestrator requires an explicit request by name.",
    };
  }

  if (workload.requiresAgent) {
    return {
      kind: "CONTROL_PLANE",
      workload,
      preset: null,
      infrastructureOperation: null,
      githubOperation: null,
      externalAgentClientId,
      executionLane: workload.workload === "CODING" ? "CODING" : "HEAVY",
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
      githubOperation: null,
      externalAgentClientId,
      executionLane: "TARGETED",
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
      githubOperation: null,
      externalAgentClientId: null,
      executionLane: "TARGETED",
      reason:
        "Read-only repository inspection can run on the trusted remote worker without creating a coding task.",
    };
  }

  return {
    kind: "ANSWER",
    workload,
    preset: null,
    infrastructureOperation: null,
    githubOperation: null,
    externalAgentClientId: null,
    executionLane: workload.useLlm ? "TARGETED" : "NO_WORKER",
    reason:
      "This request can be answered without mutating the repository or production system.",
  };
}

