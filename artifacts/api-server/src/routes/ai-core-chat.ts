import { randomUUID } from "node:crypto";
import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  aiCodingRunsTable,
  aiCodingTasksTable,
  db,
} from "@workspace/db";
import { startCodingOrchestration } from "../services/codingOrchestratorService.js";
import {
  createConstrainedCodingProviderAdapter,
} from "../services/localCodingAiExecutionGateService.js";
import {
  createConstrainedModelInvocationAdapter,
  type ConstrainedModelProvider,
} from "../services/localCodingAiModelAdapterService.js";
import {
  describePreferredCodingModelConfig,
  resolveConfiguredCodingFallbackModel,
} from "../services/localCodingAiPreferredModelService.js";
import {
  readProductionCodingModelConfig,
  resolveProductionCodingModel,
  type ProductionCodingModelSelection,
} from "../services/localCodingAiProductionModelService.js";
import { createScheduledOllamaProviderAdapter } from "../services/localCodingOllamaWorkerProviderService.js";
import {
  enableAutonomousCodingTask,
  getAutonomousCodingTaskStatus,
  getAutonomousRuntimeStatus,
} from "../services/localCodingAutonomousRepairService.js";
import {
  classifyAiCoreWorkload,
  describeAiCoreWorkloadRouting,
  selectCloudModelForWorkload,
  type AiCoreWorkload,
  type AiCoreWorkloadRoute,
} from "../services/aiCoreWorkloadRouterService.js";
import { tryRunAiCoreDataTool } from "../services/aiCoreDataToolService.js";

const router = Router();

const ChatRequest = z.object({
  message: z.string().trim().min(1).max(50_000),
  mode: z.enum(["ask", "agent"]).default("ask"),
  modelPolicy: z.enum(["economy", "smart", "auto", "cloud"]).default("smart"),
  projectName: z.string().trim().min(1).max(200).optional(),
  repository: z.string().trim().min(1).max(500).optional(),
  branch: z.string().trim().min(1).max(200).optional(),
  priority: z.number().int().min(0).max(100).optional(),
}).strict();

const TaskId = z.string().uuid();

type ChatPolicy = z.infer<typeof ChatRequest>["modelPolicy"];

function createTaskNumber(): string {
  return `CWS-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function isLocalProvider(provider: string): boolean {
  return ["ollama", "zerollm"].includes(provider.trim().toLowerCase());
}

function safeProviderFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function unavailableAskReply(
  reply: string,
  warning: string,
  metadata: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind: "answer",
    route: "NO_LLM",
    provider: null,
    model: null,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    ...metadata,
    reply,
    warning,
  };
}

function buildChatProvider(
  selection: ProductionCodingModelSelection,
  requestId: string,
): ConstrainedModelProvider {
  const providerSlug = String(selection.provider.slug).trim().toLowerCase();
  const modelId = String(selection.model.modelId).trim();
  const baseUrl =
    typeof selection.provider.baseUrl === "string" && selection.provider.baseUrl.trim()
      ? selection.provider.baseUrl.trim()
      : null;

  if (providerSlug === "ollama" && !baseUrl) {
    return createScheduledOllamaProviderAdapter({ modelId });
  }

  return createConstrainedCodingProviderAdapter({
    providerSlug,
    modelId,
    ...(baseUrl ? { baseUrl } : {}),
    observability: {
      conversationId: requestId,
      agentName: "AI Core Chat",
      providerName: providerSlug,
      modelName: modelId,
      requestType: "chat",
      createdBy: "ai-core-chat",
    },
  });
}

async function invokeChatModel(
  selection: ProductionCodingModelSelection,
  message: string,
): Promise<{
  reply: string;
  provider: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  latencyMs: number;
}> {
  const requestId = randomUUID();
  const provider = String(selection.provider.slug).trim().toLowerCase();
  const model = String(selection.model.modelId).trim();
  const adapter = createConstrainedModelInvocationAdapter(
    buildChatProvider(selection, requestId),
  );

  const response = await adapter.invoke({
    requestId,
    target: { provider, model },
    input: JSON.stringify({
      version: 1,
      system: [
        "You are AI Core Chat, the internal assistant for the AI Core control plane.",
        "Answer the user's question directly and concisely.",
        "This is ASK MODE: you have no tools and must never claim that code, shell commands, deployments, merges, database changes, or external actions were executed.",
        "If the user requests an action that changes a repository or system, explain that Agent Mode should be used.",
        "Never reveal or request secret values, API keys, passwords, tokens, or private credentials.",
        "Prefer Indonesian when the user writes Indonesian; otherwise follow the user's language.",
      ].join(" "),
      user: message,
    }),
    responseFormat: { type: "text" },
    maxOutputTokens: Math.min(4_096, selection.maxOutputTokens || 1_600),
    timeoutMs: selection.timeoutMs,
  });

  if (response.output.type !== "text") {
    throw new Error("AI Core Chat model returned a non-text response.");
  }

  return {
    reply: response.output.text,
    provider,
    model,
    usage: response.metadata.usage,
    latencyMs: response.metadata.latencyMs,
  };
}

async function resolveLocalSelection(): Promise<
  | { ok: true; selection: ProductionCodingModelSelection }
  | { ok: false; message: string }
> {
  const local = await resolveConfiguredCodingFallbackModel();
  if (!local.ok) return { ok: false, message: local.message };
  return { ok: true, selection: local.selection };
}

async function resolveCloudSelection(workload: AiCoreWorkload): Promise<
  | { ok: true; selection: ProductionCodingModelSelection }
  | { ok: false; message: string }
> {
  const workloadModel = await selectCloudModelForWorkload(workload).catch(() => null);
  if (workloadModel) {
    const baseConfig = readProductionCodingModelConfig();
    return {
      ok: true,
      selection: {
        model: workloadModel.model,
        provider: workloadModel.provider,
        timeoutMs: baseConfig.timeoutMs,
        maxOutputTokens: workloadModel.maxOutputTokens,
        selectionReason: "AUTO_CODING_CAPABILITY",
      },
    };
  }

  const base = readProductionCodingModelConfig();
  const provider = (
    process.env["AI_CODING_PRIMARY_PROVIDER"] ||
    base.provider ||
    "openai"
  ).trim().toLowerCase();
  const model = (
    process.env["AI_CODING_PRIMARY_MODEL"] ||
    base.model ||
    "gpt-5.6-sol"
  ).trim();

  if (isLocalProvider(provider)) {
    return {
      ok: false,
      message: "Configured primary coding provider is local; no cloud-only target is configured.",
    };
  }

  const resolved = await resolveProductionCodingModel({
    ...base,
    provider,
    model,
  });
  if (!resolved.ok) return { ok: false, message: resolved.message };
  if (isLocalProvider(String(resolved.selection.provider.slug))) {
    return { ok: false, message: "Cloud-only model resolution returned a local provider." };
  }
  return { ok: true, selection: resolved.selection };
}

async function deterministicReply(
  message: string,
  workload: AiCoreWorkloadRoute,
): Promise<Record<string, unknown> | null> {
  const command = message.trim().toLowerCase();
  const routingMeta = {
    workload: workload.workload,
    costClass: workload.costClass,
  };

  if (["hello", "hi", "halo", "hai", "hey"].includes(command)) {
    return {
      kind: "answer",
      route: "NO_LLM",
      provider: null,
      model: null,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      ...routingMeta,
      reply:
        "Halo. AI Core Chat aktif. Gunakan Ask untuk bertanya atau Agent untuk menjalankan coding task. Sapaan ini memakai 0 token LLM.",
    };
  }

  if (["/help", "help", "bantuan"].includes(command)) {
    return {
      kind: "answer",
      route: "NO_LLM",
      provider: null,
      model: null,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      ...routingMeta,
      reply:
        "Perintah cepat: /status untuk runtime AI Core, /model untuk model coding, /routing untuk kebijakan biaya/model, Ask Smart untuk chat cepat hemat biaya, dan Agent Mode untuk coding melalui policy gate.",
    };
  }

  if (["/status", "status", "cek status", "status ai core", "health", "/health", "healthz", "/healthz", "cek health"].includes(command)) {
    const local = await resolveLocalSelection().catch((error: unknown) => ({
      ok: false as const,
      message: error instanceof Error ? error.message : String(error),
    }));
    const runtime = getAutonomousRuntimeStatus();
    return {
      kind: "answer",
      route: "NO_LLM",
      provider: null,
      model: null,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      ...routingMeta,
      reply:
        `AI Core runtime: autonomous ${runtime.running ? "RUNNING" : "STOPPED"}; local AI ${local.ok ? "READY" : "UNAVAILABLE"}. Perintah ini memakai 0 token LLM.`,
      status: {
        autonomous: runtime,
        localModelReady: local.ok,
        ...(local.ok
          ? {
              localProvider: local.selection.provider.slug,
              localModel: local.selection.model.modelId,
            }
          : { localError: local.message }),
      },
    };
  }

  if (["/routing", "routing", "routing biaya", "/cost", "cost", "biaya"].includes(command)) {
    return {
      kind: "answer",
      route: "NO_LLM",
      provider: null,
      model: null,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      ...routingMeta,
      reply:
        "Routing biaya aktif: status/perintah deterministic = 0 token; chat dan review = LOW; reasoning = MEDIUM; coding = Coding Orchestrator; tindakan production = explicit approval gate.",
      routingPolicy: describeAiCoreWorkloadRouting(),
    };
  }

  if (["/model", "model", "model status", "routing model"].includes(command)) {
    const config = describePreferredCodingModelConfig();
    return {
      kind: "answer",
      route: "NO_LLM",
      provider: null,
      model: null,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      ...routingMeta,
      reply:
        `Routing coding saat ini: primary ${String(config["primaryProvider"])} / ${String(config["primaryModel"])}, fallback ${String(config["fallbackProvider"])} / ${String(config["fallbackModel"])}. Ask Mode Economy tetap memprioritaskan local AI tanpa cloud.`,
      modelConfig: config,
    };
  }

  return null;
}

async function answerAskMode(
  message: string,
  policy: ChatPolicy,
): Promise<Record<string, unknown>> {
  const workload = classifyAiCoreWorkload(message);
  const routingMeta = {
    workload: workload.workload,
    costClass: workload.costClass,
  };
  const deterministic = await deterministicReply(message, workload);
  if (deterministic) return deterministic;

  // Read-only data tools run before any LLM. They never accept mutation verbs and
  // only execute parameterized SELECT queries against known business tables.
  const dataTool = await tryRunAiCoreDataTool(message);
  if (dataTool.matched) {
    return {
      kind: "answer",
      route: "DATA_TOOL",
      provider: null,
      model: null,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      workload: "DATA_LOOKUP",
      costClass: "ZERO",
      reply: dataTool.reply,
      dataTool: dataTool.tool,
      data: dataTool.data,
      ...(dataTool.warning ? { warning: dataTool.warning } : {}),
    };
  }

  if (workload.workload === "CRITICAL_ACTION") {
    return {
      kind: "answer",
      route: "NO_LLM",
      provider: null,
      model: null,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      ...routingMeta,
      reply:
        "Tindakan production/kritis tidak dijalankan sebagai chat. Gunakan Agent Mode; AI Core akan menjalankannya melalui control plane dan berhenti pada explicit approval gate. Klasifikasi ini memakai 0 token LLM.",
      requiresApproval: true,
    };
  }

  if (workload.workload === "CODING") {
    return {
      kind: "answer",
      route: "NO_LLM",
      provider: null,
      model: null,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      ...routingMeta,
      reply:
        "Instruksi ini terdeteksi sebagai pekerjaan coding yang mengubah repository. Gunakan Agent Mode agar masuk Coding Orchestrator, test, review, dan approval gate. Routing ini memakai 0 token LLM.",
      requiresAgent: true,
    };
  }

  if (policy === "smart") {
    const cloud = await resolveCloudSelection(workload.workload);
    if (cloud.ok) {
      try {
        const result = await invokeChatModel(cloud.selection, message);
        return { kind: "answer", route: "CLOUD", ...routingMeta, ...result };
      } catch (cloudError) {
        const local = await resolveLocalSelection();
        if (local.ok) {
          try {
            const result = await invokeChatModel(local.selection, message);
            return {
              kind: "answer",
              route: "LOCAL",
              ...routingMeta,
              ...result,
              warning:
                "Smart cloud route gagal, jadi AI Core memakai local fallback: " +
                safeProviderFailure(cloudError),
            };
          } catch (localError) {
            return unavailableAskReply(
              "Smart cloud dan local fallback sama-sama gagal menjawab.",
              [safeProviderFailure(cloudError), safeProviderFailure(localError)]
                .filter(Boolean)
                .join(" | "),
              routingMeta,
            );
          }
        }
        return unavailableAskReply(
          "Smart cloud gagal dan local fallback tidak tersedia.",
          [safeProviderFailure(cloudError), local.message].filter(Boolean).join(" | "),
          routingMeta,
        );
      }
    }

    const local = await resolveLocalSelection();
    if (local.ok) {
      try {
        const result = await invokeChatModel(local.selection, message);
        return { kind: "answer", route: "LOCAL", ...routingMeta, ...result };
      } catch (error) {
        return unavailableAskReply(
          "Tidak ada cloud model hemat yang tersedia dan local AI juga gagal menjawab.",
          safeProviderFailure(error) || "Local AI invocation failed.",
          routingMeta,
        );
      }
    }

    return unavailableAskReply(
      "Tidak ada cloud model yang sesuai maupun local AI yang tersedia.",
      cloud.message + " | " + local.message,
      routingMeta,
    );
  }

  if (policy === "economy") {
    const local = await resolveLocalSelection();
    if (!local.ok) {
      return {
        kind: "answer",
        route: "NO_LLM",
        provider: null,
        model: null,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        reply:
          "Local AI sedang tidak tersedia, jadi AI Core tidak memakai OpenAI agar tetap hemat token. Pilih Auto untuk mengizinkan fallback ke cloud atau Cloud untuk memakai provider cloud secara langsung.",
        warning: local.message,
      };
    }
    try {
      const result = await invokeChatModel(local.selection, message);
      return { kind: "answer", route: "LOCAL", ...routingMeta, ...result };
    } catch (error) {
      return unavailableAskReply(
        "Local AI terdeteksi tetapi gagal menjawab. Economy tidak akan memakai OpenAI secara otomatis. Pastikan Ollama worker online, atau pilih Auto untuk mengizinkan fallback cloud.",
        safeProviderFailure(error) || "Local AI invocation failed.",
        routingMeta,
      );
    }
  }

  if (policy === "cloud") {
    const cloud = await resolveCloudSelection(workload.workload);
    if (!cloud.ok) {
      return {
        kind: "answer",
        route: "NO_LLM",
        provider: null,
        model: null,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        reply: "Cloud model belum tersedia untuk AI Core Chat.",
        warning: cloud.message,
      };
    }
    try {
      const result = await invokeChatModel(cloud.selection, message);
      return { kind: "answer", route: "CLOUD", ...routingMeta, ...result };
    } catch (error) {
      return unavailableAskReply(
        "Cloud AI sedang tidak dapat menjawab. Tidak ada tindakan sistem yang dijalankan.",
        safeProviderFailure(error) || "Cloud AI invocation failed.",
        routingMeta,
      );
    }
  }

  const local = await resolveLocalSelection();
  let localFailure = local.ok ? "" : local.message;
  if (local.ok) {
    try {
      const result = await invokeChatModel(local.selection, message);
      return { kind: "answer", route: "LOCAL", ...routingMeta, ...result };
    } catch (error) {
      // Auto mode is explicitly allowed to fall through to the configured cloud target.
      localFailure = safeProviderFailure(error) || "Local AI invocation failed.";
    }
  }

  const cloud = await resolveCloudSelection(workload.workload);
  if (!cloud.ok) {
    return unavailableAskReply(
      "Local AI gagal dan cloud fallback juga tidak tersedia.",
      [localFailure, cloud.message].filter(Boolean).join(" | "),
      routingMeta,
    );
  }

  try {
    const result = await invokeChatModel(cloud.selection, message);
    return { kind: "answer", route: "CLOUD_FALLBACK", ...routingMeta, ...result };
  } catch (error) {
    return unavailableAskReply(
      "Local AI dan cloud fallback sama-sama gagal menjawab. Coba lagi setelah provider pulih.",
      [localFailure, safeProviderFailure(error)].filter(Boolean).join(" | "),
      routingMeta,
    );
  }
}

async function startAgentTask(input: z.infer<typeof ChatRequest>): Promise<Record<string, unknown>> {
  if (!input.projectName || !input.repository || !input.branch) {
    return {
      kind: "validation",
      reply: "Agent Mode membutuhkan Project, Repository, dan Branch sebelum task dapat dijalankan.",
      missing: [
        ...(!input.projectName ? ["projectName"] : []),
        ...(!input.repository ? ["repository"] : []),
        ...(!input.branch ? ["branch"] : []),
      ],
    };
  }

  const { task, run } = await db.transaction(async (tx) => {
    const [createdTask] = await tx
      .insert(aiCodingTasksTable)
      .values({
        taskNumber: createTaskNumber(),
        projectName: input.projectName!,
        repository: input.repository!,
        branch: input.branch!,
        instruction: input.message,
        priority: input.priority ?? 50,
        status: "PENDING",
      })
      .returning();

    if (!createdTask) throw new Error("Failed to create AI Core coding task.");

    const [createdRun] = await tx
      .insert(aiCodingRunsTable)
      .values({
        taskId: createdTask.id,
        agentName: "Coding Orchestrator",
        status: "RUNNING",
        startedAt: new Date(),
      })
      .returning();

    if (!createdRun) throw new Error("Failed to create Coding Orchestrator run.");

    const [updatedTask] = await tx
      .update(aiCodingTasksTable)
      .set({ status: "ANALYZING" })
      .where(eq(aiCodingTasksTable.id, createdTask.id))
      .returning();

    return { task: updatedTask ?? createdTask, run: createdRun };
  });

  try {
    await startCodingOrchestration({ task, run });
    await enableAutonomousCodingTask(task.id, 40);
  } catch (error) {
    await db
      .update(aiCodingTasksTable)
      .set({
        status: "FAILED",
        resultSummary:
          "AI Core Chat could not start the Coding Orchestrator: " +
          (error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)),
      })
      .where(eq(aiCodingTasksTable.id, task.id));
    throw error;
  }

  return {
    kind: "agent",
    route: "CONTROL_PLANE",
    provider: null,
    model: null,
    usage: null,
    reply:
      `Task ${task.taskNumber} dimulai. AI Core akan menganalisis repository, menjalankan langkah aman secara otomatis, dan berhenti pada critical approval seperti merge/deploy/database/security.`,
    taskId: task.id,
    taskNumber: task.taskNumber,
    status: "ANALYZING",
    workspaceUrl: `/coding-workspace/${task.id}`,
    autonomous: true,
  };
}

router.get("/ai/core-chat/config", async (_req, res): Promise<void> => {
  const [local] = await Promise.all([
    resolveLocalSelection().catch((error: unknown) => ({
      ok: false as const,
      message: error instanceof Error ? error.message : String(error),
    })),
  ]);
  const modelConfig = describePreferredCodingModelConfig();
  const runtime = getAutonomousRuntimeStatus();

  res.json({
    defaultMode: "ask",
    defaultModelPolicy: "smart",
    routing: ["NO_LLM", "DATA_TOOL", "SMART_CLOUD", "LOCAL", "CLOUD"],
    workloadRouting: describeAiCoreWorkloadRouting(),
    local: local.ok
      ? {
          ready: true,
          provider: local.selection.provider.slug,
          model: local.selection.model.modelId,
        }
      : { ready: false, error: local.message },
    autonomous: runtime,
    codingModel: modelConfig,
    secretsExposed: false,
  });
});

router.post("/ai/core-chat/messages", async (req, res): Promise<void> => {
  const parsed = ChatRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const result =
      parsed.data.mode === "agent"
        ? await startAgentTask(parsed.data)
        : await answerAskMode(parsed.data.message, parsed.data.modelPolicy);

    res.status(result["kind"] === "agent" ? 202 : 200).json(result);
  } catch (error) {
    res.status(503).json({
      error:
        error instanceof Error
          ? error.message.slice(0, 1_500)
          : "AI Core Chat request failed.",
    });
  }
});

router.get("/ai/core-chat/tasks/:id/progress", async (req, res): Promise<void> => {
  const taskId = TaskId.safeParse(req.params["id"]);
  if (!taskId.success) {
    res.status(400).json({ error: "Invalid task id" });
    return;
  }

  const [task] = await db
    .select()
    .from(aiCodingTasksTable)
    .where(eq(aiCodingTasksTable.id, taskId.data))
    .limit(1);

  if (!task) {
    res.status(404).json({ error: "Coding task not found" });
    return;
  }

  const [latestRun] = await db
    .select()
    .from(aiCodingRunsTable)
    .where(eq(aiCodingRunsTable.taskId, task.id))
    .orderBy(desc(aiCodingRunsTable.startedAt))
    .limit(1);

  const autonomous = await getAutonomousCodingTaskStatus(task.id).catch(() => null);

  res.json({
    task: {
      id: task.id,
      taskNumber: task.taskNumber,
      projectName: task.projectName,
      repository: task.repository,
      branch: task.branch,
      status: task.status,
      resultSummary: task.resultSummary,
      updatedAt: task.updatedAt,
    },
    autonomous,
    latestRun: latestRun
      ? {
          id: latestRun.id,
          agentName: latestRun.agentName,
          status: latestRun.status,
          errorMessage: latestRun.errorMessage,
          startedAt: latestRun.startedAt,
          finishedAt: latestRun.finishedAt,
        }
      : null,
    workspaceUrl: `/coding-workspace/${task.id}`,
  });
});

export default router;
