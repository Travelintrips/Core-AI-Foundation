import { randomUUID } from "node:crypto";
import { Router, type Response } from "express";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  aiCodingRunsTable,
  aiCodingTasksTable,
  db,
  isTransientDatabaseConnectionError,
  withTransientDatabaseRetry,
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
  resolveAlternativeCloudCodingModels,
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
import {
  classifyAiCoreChatDispatch,
  DEFAULT_AI_CORE_CHAT_MODE,
  detectRemoteWorkerPreset,
  isAiCoreCapabilityQuery,
  type RemoteWorkerPreset,
} from "../services/aiCoreChatIntentService.js";
import {
  getAiCoreDataToolReadiness,
  tryRunAiCoreDataTool,
} from "../services/aiCoreDataToolService.js";
import {
  detectAiCoreInfrastructureOperation,
  executeAiCoreInfrastructureOperation,
} from "../services/aiCoreInfrastructureControlService.js";
import {
  getAiCoreCapabilityRegistrySnapshot,
  renderAiCoreCapabilityRegistry,
} from "../services/aiCoreCapabilityRegistryService.js";
import {
  dispatchExternalAgentWork,
  getExternalAgentWorkState,
  N8N_AGENT_CLIENT_ID,
  OPENCLAW_AGENT_CLIENT_ID,
  OPENHANDS_AGENT_CLIENT_ID,
} from "../services/externalAgentDispatchService.js";
import {
  buildAdminDbUnresolvedAnswer,
  executeAdminMutationSql,
  executeAdminNaturalTextLookup,
  executeAdminReadOnlySql,
  executeAdminSemanticQuery,
  extractAdminDbSemanticIntent,
  extractExplicitAdminMutationSql,
  extractExplicitReadOnlySql,
  formatAdminDbSchemaCatalog,
  inspectAdminDbSchemaCatalog,
  sanitizeAdminDbError,
  renderAdminDbMutationResult,
  renderAdminDbQueryResult,
  renderAdminSemanticQueryResult,
  shouldAttemptAdminDbQuery,
  type AdminDbConversationMessage,
  type AdminDbDiscovery,
} from "../services/aiCoreAdminDbQueryService.js";
import { streamCloudChatNoFallback } from "../services/aiChatStreamingService.js";
import { deactivateRegisteredModel } from "../services/aiModelService.js";
import { runRemoteTrustedPowerShellTask } from "../services/remoteTrustedPowerShellTaskService.js";
import {
  appendLearningsToMessage,
  promoteExplicitChatLearning,
  recordChatLearningEvent,
  retrieveChatLearnings,
} from "../services/aiCoreChatLearningService.js";

const router = Router();

const ChatRequest = z.object({
  message: z.string().trim().min(1).max(50_000),
  mode: z.enum(["auto", "ask", "agent"]).default(DEFAULT_AI_CORE_CHAT_MODE),
  modelPolicy: z.enum(["economy", "smart", "auto", "cloud"]).default("smart"),
  projectName: z.string().trim().min(1).max(200).optional(),
  repository: z.string().trim().min(1).max(500).optional(),
  branch: z.string().trim().min(1).max(200).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  conversationId: z.string().trim().min(1).max(200).optional(),
  context: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      text: z.string().trim().min(1).max(5_000),
    }).strict(),
  ).max(12).optional(),
}).strict();

const TaskId = z.string().uuid();

type ChatPolicy = z.infer<typeof ChatRequest>["modelPolicy"];

const ASK_SYSTEM_PROMPT = [
  "You are AI Core Chat, the internal assistant for the AI Core control plane.",
  "Answer the user's question directly and concisely.",
  "This is the non-mutating answer path for the current response: do not claim that this path itself executed code, shell commands, deployments, merges, database changes, or external actions.",
  "AI Core Chat as a whole can execute read-only checks through trusted workers and can route coding work into the Coding Orchestrator/control plane automatically. When asked about capabilities, describe the overall AI Core Chat system, not only this answer path.",
  "Mutating requests are routed by AI Core to the control plane before this prompt is used; critical production actions must still stop at explicit approval gates.",
  "Never reveal or request secret values, API keys, passwords, tokens, or private credentials.",
  "Prefer Indonesian when the user writes Indonesian; otherwise follow the user's language.",
].join(" ");

const ADMIN_DB_PLANNER_SYSTEM_PROMPT = [
  "You are the PostgreSQL query planner for AI Core Chat's authenticated admin-only read path.",
  "Your job is to decide whether the user's request should read the database and, if so, produce exactly one safe read-only PostgreSQL query.",
  "Return exactly one JSON object and no markdown: {\"shouldQuery\":true|false,\"sql\":\"SELECT ...\"|null,\"databaseId\":\"primary or listed connection id\",\"reason\":\"short reason\"}.",
  "Only SELECT or WITH queries are allowed. Never emit INSERT, UPDATE, DELETE, MERGE, CREATE, ALTER, DROP, TRUNCATE, GRANT, REVOKE, COPY, CALL, DO, locking clauses, or functions that read server files or perform network access.",
  "Use only tables and columns listed in the supplied schema catalog. Return the databaseId listed with the chosen tables. A query must use tables from exactly one database connection.",
  "For fuzzy human names, company names, emails, phone numbers, codes, or labels, prefer ILIKE with surrounding percent wildcards unless the user explicitly asks for exact matching.",
  "Use explicit JOIN conditions. Never invent columns.",
  "Prefer LIMIT 100 for row listings. Aggregate/count queries may omit LIMIT.",
  "If the request is conceptual rather than asking for stored data, return shouldQuery=false.",
].join(" ");

const AdminDbPlan = z.object({
  shouldQuery: z.boolean(),
  databaseId: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/).optional(),
  sql: z.string().trim().min(1).nullable(),
  reason: z.string().trim().max(500).optional(),
});

function createTaskNumber(): string {
  return `CWS-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function isLocalProvider(provider: string): boolean {
  return ["ollama", "zerollm"].includes(provider.trim().toLowerCase());
}

type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

function numericCost(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function estimateSelectionCostUsd(
  selection: ProductionCodingModelSelection,
  usage: TokenUsage | null,
): number | null {
  if (!usage) return null;

  const provider = String(selection.provider.slug).trim().toLowerCase();
  if (["ollama", "zerollm"].includes(provider)) return 0;

  const pricedModel = selection.model as typeof selection.model & {
    costPerInputToken?: unknown;
    costPerOutputToken?: unknown;
  };
  const inputUnit = numericCost(pricedModel.costPerInputToken);
  const outputUnit = numericCost(pricedModel.costPerOutputToken);
  if (inputUnit == null || outputUnit == null) return null;

  const estimated =
    usage.inputTokens * inputUnit + usage.outputTokens * outputUnit;
  return Number.isFinite(estimated)
    ? Number(estimated.toFixed(8))
    : null;
}

function safeProviderFailure(error: unknown): string {
  if (isTransientDatabaseConnectionError(error)) {
    return "Database AI Core sementara sibuk atau tidak tersedia. Silakan ulangi permintaan sebentar lagi.";
  }

  const message = error instanceof Error ? error.message : String(error);
  const normalized = message
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (/^failed query:/i.test(normalized) || /from ["']?ai_platform["']?/i.test(normalized)) {
    return "Database AI Core gagal memproses permintaan. Detail query disembunyikan dari tampilan chat.";
  }

  return normalized.slice(0, 500);
}

function isExplicitRetiredModelFailure(
  providerSlug: string,
  error: unknown,
): boolean {
  const provider = providerSlug.trim().toLowerCase();
  if (!["google", "gemini", "google-gemini"].includes(provider)) return false;

  const detail = safeProviderFailure(error).toLowerCase();
  const explicitRetirement =
    detail.includes("no longer available") ||
    detail.includes("model is no longer available") ||
    detail.includes("model has been retired") ||
    detail.includes("model was retired");
  const explicitModelNotFound =
    detail.includes("http 404") &&
    (detail.includes('"status":"not_found"') ||
      detail.includes("status: not_found") ||
      detail.includes("model") && detail.includes("not found"));

  return explicitRetirement || explicitModelNotFound;
}

async function quarantineRetiredCloudModel(
  selection: ProductionCodingModelSelection,
  error: unknown,
): Promise<boolean> {
  const provider = String(selection.provider.slug).trim().toLowerCase();
  const model = String(selection.model.modelId).trim();
  if (!isExplicitRetiredModelFailure(provider, error)) return false;

  await deactivateRegisteredModel(provider, model).catch(() => false);
  return true;
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
    estimatedCostUsd: 0,
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
    return createScheduledOllamaProviderAdapter({
      modelId,
      queuePriority: 95,
    });
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
  systemPrompt = ASK_SYSTEM_PROMPT,
): Promise<{
  reply: string;
  provider: string;
  model: string;
  usage: TokenUsage;
  latencyMs: number;
  estimatedCostUsd: number | null;
}> {
  const requestId = randomUUID();
  const provider = String(selection.provider.slug).trim().toLowerCase();
  const model = String(selection.model.modelId).trim();
  const adapter = createConstrainedModelInvocationAdapter(
    buildChatProvider(selection, requestId),
  );

  const localProvider = isLocalProvider(provider);
  // Interactive local chat must stay comfortably inside the remote Ollama
  // worker's bounded invocation window (45s by default) and the Hostinger
  // edge timeout. Coding/planner calls use their own model invocation paths
  // and are not reduced by this chat-only budget.
  const chatMaxOutputTokens = localProvider
    ? Math.min(512, selection.maxOutputTokens || 512)
    : Math.min(4_096, selection.maxOutputTokens || 1_600);
  const chatTimeoutMs = localProvider
    ? Math.min(40_000, selection.timeoutMs)
    : selection.timeoutMs;

  const response = await adapter.invoke({
    requestId,
    target: { provider, model },
    input: JSON.stringify({
      version: 1,
      system: systemPrompt,
      user: message,
    }),
    responseFormat: { type: "text" },
    maxOutputTokens: chatMaxOutputTokens,
    timeoutMs: chatTimeoutMs,
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
    estimatedCostUsd: estimateSelectionCostUsd(
      selection,
      response.metadata.usage,
    ),
  };
}

async function resolveCloudFallbackSelections(
  primary: ProductionCodingModelSelection,
): Promise<ProductionCodingModelSelection[]> {
  const alternatives = await resolveAlternativeCloudCodingModels({
    excludeTargets: [{
      provider: String(primary.provider.slug),
      model: String(primary.model.modelId),
    }],
    limit: 5,
  });
  if (!alternatives.ok) return [];

  const primaryProvider = String(primary.provider.slug).trim().toLowerCase();
  return [...alternatives.selections].sort((left, right) => {
    const leftProvider = String(left.provider.slug).trim().toLowerCase();
    const rightProvider = String(right.provider.slug).trim().toLowerCase();
    const leftSame = leftProvider === primaryProvider ? 0 : 1;
    const rightSame = rightProvider === primaryProvider ? 0 : 1;
    if (leftSame !== rightSame) return leftSame - rightSame;

    if (primaryProvider === "google" || primaryProvider === "gemini" || primaryProvider === "google-gemini") {
      const leftGemini25 = String(left.model.modelId) === "gemini-2.5-pro" ? 0 : 1;
      const rightGemini25 = String(right.model.modelId) === "gemini-2.5-pro" ? 0 : 1;
      if (leftGemini25 !== rightGemini25) return leftGemini25 - rightGemini25;
    }
    return 0;
  });
}

async function invokeCloudFallbackChain(
  primary: ProductionCodingModelSelection,
  message: string,
  systemPrompt = ASK_SYSTEM_PROMPT,
): Promise<
  | { ok: true; result: Awaited<ReturnType<typeof invokeChatModel>>; selection: ProductionCodingModelSelection }
  | { ok: false; errors: string[] }
> {
  const selections = await resolveCloudFallbackSelections(primary);
  const errors: string[] = [];
  for (const selection of selections) {
    try {
      const result = await invokeChatModel(selection, message, systemPrompt);
      return { ok: true, result, selection };
    } catch (error) {
      await quarantineRetiredCloudModel(selection, error);
      errors.push(
        String(selection.provider.slug) + "/" + String(selection.model.modelId) + ": " +
        (safeProviderFailure(error) || "provider failed"),
      );
    }
  }
  return { ok: false, errors };
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

function parseAdminDbPlan(raw: string): z.infer<typeof AdminDbPlan> {
  const cleaned = raw
    .trim()
    .replace(/^\`\`\`(?:json)?\s*/i, "")
    .replace(/\`\`\`\s*$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Database planner did not return JSON.");
  }
  return AdminDbPlan.parse(JSON.parse(cleaned.slice(start, end + 1)));
}

async function tryRunAdminDbQuery(
  message: string,
  policy: ChatPolicy,
  context: AdminDbConversationMessage[] = [],
): Promise<Record<string, unknown> | null> {
  const semanticQuery = await executeAdminSemanticQuery(message, context);
  if (semanticQuery) {
    return {
      kind: "answer",
      route: "ADMIN_DB_QUERY",
      provider: null,
      model: null,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
      estimatedCostUsd: 0,
      workload: "DATA_LOOKUP",
      costClass: "ZERO",
      reply: renderAdminSemanticQueryResult(semanticQuery),
      databaseQuery: {
        sql: semanticQuery.sql,
        rowCount: semanticQuery.rowCount,
        truncated: semanticQuery.truncated,
        elapsedMs: semanticQuery.elapsedMs,
        reason:
          "Schema-aware semantic aggregate over dynamically discovered application tables.",
        access: "ADMIN_READ_ONLY",
        confidence: semanticQuery.confidence,
        sourceTable: semanticQuery.sourceTable,
        sourceDatabaseId: semanticQuery.sourceDatabaseId,
        discovery: semanticQuery.discovery,
        valueColumn: semanticQuery.valueColumn,
        timeColumn: semanticQuery.timeColumn,
        statusFilterApplied: semanticQuery.statusFilterApplied,
        inheritedFromContext: semanticQuery.intent.inheritedFromContext,
      },
      data: semanticQuery.rows,
    };
  }

  if (!shouldAttemptAdminDbQuery(message) && !extractAdminDbSemanticIntent(message, context)) return null;

  const deterministicLookup = await executeAdminNaturalTextLookup(message);
  if (deterministicLookup) {
    return {
      kind: "answer",
      route: "ADMIN_DB_QUERY",
      provider: null,
      model: null,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
      estimatedCostUsd: 0,
      workload: "DATA_LOOKUP",
      costClass: "ZERO",
      reply: renderAdminDbQueryResult(deterministicLookup),
      databaseQuery: {
        sql: deterministicLookup.sql,
        rowCount: deterministicLookup.rowCount,
        truncated: deterministicLookup.truncated,
        elapsedMs: deterministicLookup.elapsedMs,
        reason: "Deterministic dynamic text lookup over discovered application tables.",
        access: "ADMIN_READ_ONLY",
      },
      data: deterministicLookup.rows,
    };
  }

  const explicitSql = extractExplicitReadOnlySql(message);
  let plannedSql = explicitSql;
  let databaseId = "primary";
  let discovery: AdminDbDiscovery = { databases: [], tableCount: 0 };
  let plannerProvider: string | null = null;
  let plannerModel: string | null = null;
  let plannerUsage: TokenUsage | null = null;
  let plannerReason = explicitSql
    ? "Explicit admin SELECT/WITH query."
    : "Natural-language admin database lookup.";

  if (!plannedSql) {
    const inspected = await inspectAdminDbSchemaCatalog(message);
    const schemaCatalog = inspected.tables;
    discovery = inspected.discovery;
    const databaseIds = new Set(schemaCatalog.map((table) => table.databaseId ?? "primary"));
    const selectedDatabase = (id?: string): string => {
      if (id && databaseIds.has(id)) return id;
      if (!id && databaseIds.size === 1) return [...databaseIds][0]!;
      throw new Error("Database planner belum memilih satu koneksi terdaftar yang sesuai dengan metadata.");
    };
    const schemaText = formatAdminDbSchemaCatalog(schemaCatalog);
    const recentContext = context
      .slice(-8)
      .map((item) => item.role.toUpperCase() + ": " + item.text)
      .join("\n");
    const plannerMessage = [
      ...(recentContext
        ? ["RECENT CONVERSATION:", recentContext, ""]
        : []),
      "USER REQUEST:",
      message,
      "",
      "AVAILABLE DATABASE SCHEMA:",
      schemaText,
    ].join("\n");

    const useLocalOnly = policy === "economy";
    const cloud = useLocalOnly
      ? { ok: false as const, message: "Economy policy uses local planner." }
      : await resolveCloudSelection("REASONING");

    if (cloud.ok) {
      try {
        const planned = await invokeChatModel(
          cloud.selection,
          plannerMessage,
          ADMIN_DB_PLANNER_SYSTEM_PROMPT,
        );
        const plan = parseAdminDbPlan(planned.reply);
        if (!plan.shouldQuery || !plan.sql) return buildAdminDbUnresolvedAnswer(message, context, discovery);
        databaseId = selectedDatabase(plan.databaseId);
        plannedSql = plan.sql;
        plannerReason = plan.reason ?? plannerReason;
        plannerProvider = planned.provider;
        plannerModel = planned.model;
        plannerUsage = planned.usage;
      } catch (error) {
        const fallback = await invokeCloudFallbackChain(
          cloud.selection,
          plannerMessage,
          ADMIN_DB_PLANNER_SYSTEM_PROMPT,
        );
        if (fallback.ok) {
          const plan = parseAdminDbPlan(fallback.result.reply);
          if (!plan.shouldQuery || !plan.sql) return buildAdminDbUnresolvedAnswer(message, context, discovery);
          databaseId = selectedDatabase(plan.databaseId);
          plannedSql = plan.sql;
          plannerReason = plan.reason ?? plannerReason;
          plannerProvider = fallback.result.provider;
          plannerModel = fallback.result.model;
          plannerUsage = fallback.result.usage;
        } else {
          const local = await resolveLocalSelection();
          if (!local.ok) throw error;
          const planned = await invokeChatModel(
            local.selection,
            plannerMessage,
            ADMIN_DB_PLANNER_SYSTEM_PROMPT,
          );
          const plan = parseAdminDbPlan(planned.reply);
          if (!plan.shouldQuery || !plan.sql) return buildAdminDbUnresolvedAnswer(message, context, discovery);
          databaseId = selectedDatabase(plan.databaseId);
          plannedSql = plan.sql;
          plannerReason = plan.reason ?? plannerReason;
          plannerProvider = planned.provider;
          plannerModel = planned.model;
          plannerUsage = planned.usage;
        }
      }
    } else {
      const local = await resolveLocalSelection();
      if (!local.ok) return buildAdminDbUnresolvedAnswer(message, context, discovery);
      const planned = await invokeChatModel(
        local.selection,
        plannerMessage,
        ADMIN_DB_PLANNER_SYSTEM_PROMPT,
      );
      const plan = parseAdminDbPlan(planned.reply);
      if (!plan.shouldQuery || !plan.sql) return buildAdminDbUnresolvedAnswer(message, context, discovery);
      databaseId = selectedDatabase(plan.databaseId);
      plannedSql = plan.sql;
      plannerReason = plan.reason ?? plannerReason;
      plannerProvider = planned.provider;
      plannerModel = planned.model;
      plannerUsage = planned.usage;
    }
  }

  const result = await executeAdminReadOnlySql(plannedSql, databaseId);
  return {
    kind: "answer",
    route: "ADMIN_DB_QUERY",
    provider: plannerProvider,
    model: plannerModel,
    usage: plannerUsage ?? {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    },
    estimatedCostUsd: null,
    workload: "DATA_LOOKUP",
    costClass: plannerUsage ? "LOW" : "ZERO",
    reply: renderAdminDbQueryResult(result),
    databaseQuery: {
      sql: result.sql,
      rowCount: result.rowCount,
      truncated: result.truncated,
      elapsedMs: result.elapsedMs,
      sourceDatabaseId: result.sourceDatabaseId,
      discovery,
      reason: plannerReason,
      access: "ADMIN_READ_ONLY",
    },
    data: result.rows,
  };
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

  if (isAiCoreCapabilityQuery(command)) {
    const registry = await getAiCoreCapabilityRegistrySnapshot();
    return {
      kind: "answer",
      route: "CAPABILITY_REGISTRY",
      provider: null,
      model: null,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      estimatedCostUsd: 0,
      ...routingMeta,
      reply: renderAiCoreCapabilityRegistry(registry),
      capabilities: registry,
    };
  }

  if (["hello", "hi", "halo", "hai", "hey"].includes(command)) {
    return {
      kind: "answer",
      route: "NO_LLM",
      provider: null,
      model: null,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      estimatedCostUsd: 0,
      ...routingMeta,
      reply:
        "Halo. AI Core Chat aktif. Tanyakan, periksa, atau beri perintah dari chat yang sama; AI Core akan memilih jalur jawaban, worker read-only, atau Coding Orchestrator secara otomatis. Sapaan ini memakai 0 token LLM.",
    };
  }

  if (["/help", "help", "bantuan"].includes(command)) {
    return {
      kind: "answer",
      route: "NO_LLM",
      provider: null,
      model: null,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      estimatedCostUsd: 0,
      ...routingMeta,
      reply:
        "Perintah cepat: /status untuk runtime AI Core, /model untuk model coding, /routing untuk kebijakan biaya/model. Chat otomatis membedakan tanya, periksa/review, coding, dan tindakan kritis; coding masuk Coding Orchestrator dan tindakan kritis tetap berhenti di approval gate.",
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
      estimatedCostUsd: 0,
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
      estimatedCostUsd: 0,
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
      estimatedCostUsd: 0,
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
  context: AdminDbConversationMessage[] = [],
  routingMessage = message,
): Promise<Record<string, unknown>> {
  const workload = classifyAiCoreWorkload(routingMessage);
  const routingMeta = {
    workload: workload.workload,
    costClass: workload.costClass,
  };
  const deterministic = await deterministicReply(routingMessage, workload);
  if (deterministic) return deterministic;

  // Read-only data tools run before any LLM. They never accept mutation verbs and
  // only execute parameterized SELECT queries against known business tables.
  const dataTool = await tryRunAiCoreDataTool(routingMessage);
  if (dataTool.matched) {
    return {
      kind: "answer",
      route: "DATA_TOOL",
      provider: null,
      model: null,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      estimatedCostUsd: 0,
      workload: "DATA_LOOKUP",
      costClass: "ZERO",
      reply: dataTool.reply,
      dataTool: dataTool.tool,
      data: dataTool.data,
      ...(dataTool.warning ? { warning: dataTool.warning } : {}),
    };
  }

  const adminDbQuery = await tryRunAdminDbQuery(routingMessage, policy, context).catch(
    (error: unknown) => ({
      kind: "answer",
      route: "ADMIN_DB_QUERY",
      provider: null,
      model: null,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      estimatedCostUsd: 0,
      workload: "DATA_LOOKUP",
      costClass: "ZERO",
      reply:
        "Admin DB Query dikenali tetapi query read-only gagal. Tidak ada perubahan data yang dilakukan.",
      warning: sanitizeAdminDbError(error),
    }),
  );
  if (adminDbQuery) return adminDbQuery;

  if (workload.workload === "CRITICAL_ACTION") {
    return {
      kind: "answer",
      route: "NO_LLM",
      provider: null,
      model: null,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      estimatedCostUsd: 0,
      ...routingMeta,
      reply:
        "Tindakan production/kritis harus masuk control plane dan berhenti pada explicit approval gate. Ask-only mode tidak menjalankannya. Klasifikasi ini memakai 0 token LLM.",
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
      estimatedCostUsd: 0,
      ...routingMeta,
      reply:
        "Instruksi ini terdeteksi sebagai pekerjaan coding yang mengubah repository. Ask-only mode tidak menjalankannya; jalur Auto/Agent akan memasukkannya ke Coding Orchestrator, test, review, dan approval gate. Routing ini memakai 0 token LLM.",
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
        await quarantineRetiredCloudModel(cloud.selection, cloudError);
        const cloudFallback = await invokeCloudFallbackChain(cloud.selection, message);
        if (cloudFallback.ok) {
          return {
            kind: "answer",
            route: "CLOUD_FALLBACK",
            ...routingMeta,
            ...cloudFallback.result,
            warning:
              "Cloud primary sedang tidak tersedia; AI Core memakai cloud fallback " +
              String(cloudFallback.selection.provider.slug) + "/" +
              String(cloudFallback.selection.model.modelId) + ".",
          };
        }
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
      await quarantineRetiredCloudModel(cloud.selection, error);
      const cloudFallback = await invokeCloudFallbackChain(cloud.selection, message);
      if (cloudFallback.ok) {
        return {
          kind: "answer",
          route: "CLOUD_FALLBACK",
          ...routingMeta,
          ...cloudFallback.result,
          warning:
            "Cloud primary sedang tidak tersedia; AI Core memakai cloud fallback " +
            String(cloudFallback.selection.provider.slug) + "/" +
            String(cloudFallback.selection.model.modelId) + ".",
        };
      }
      return unavailableAskReply(
        "Semua cloud route yang tersedia gagal menjawab. Tidak ada tindakan sistem yang dijalankan.",
        [safeProviderFailure(error), ...cloudFallback.errors].filter(Boolean).join(" | "),
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
    await quarantineRetiredCloudModel(cloud.selection, error);
    const cloudFallback = await invokeCloudFallbackChain(cloud.selection, message);
    if (cloudFallback.ok) {
      return {
        kind: "answer",
        route: "CLOUD_FALLBACK",
        ...routingMeta,
        ...cloudFallback.result,
        warning:
          "Local/primary cloud route tidak tersedia; AI Core memakai cloud fallback " +
          String(cloudFallback.selection.provider.slug) + "/" +
          String(cloudFallback.selection.model.modelId) + ".",
      };
    }
    return unavailableAskReply(
      "Local AI dan seluruh cloud fallback sama-sama gagal menjawab. Coba lagi setelah provider pulih.",
      [localFailure, safeProviderFailure(error), ...cloudFallback.errors].filter(Boolean).join(" | "),
      routingMeta,
    );
  }
}

function writeStreamEvent(
  res: Response,
  event: "meta" | "delta" | "done" | "error",
  data: Record<string, unknown>,
): void {
  if (res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function writeBufferedChatStream(
  res: Response,
  result: Record<string, unknown>,
): void {
  writeStreamEvent(res, "meta", {
    route: result["route"] ?? null,
    provider: result["provider"] ?? null,
    model: result["model"] ?? null,
    workload: result["workload"] ?? null,
    costClass: result["costClass"] ?? null,
  });

  const reply = typeof result["reply"] === "string" ? result["reply"] : "";
  if (reply) {
    writeStreamEvent(res, "delta", { text: reply });
  }

  writeStreamEvent(res, "done", {
    usage: result["usage"] ?? null,
    estimatedCostUsd: result["estimatedCostUsd"] ?? null,
    warning: result["warning"] ?? null,
    taskId: result["taskId"] ?? null,
    taskNumber: result["taskNumber"] ?? null,
    status: result["status"] ?? null,
    workspaceUrl: result["workspaceUrl"] ?? null,
    databaseQuery: result["databaseQuery"] ?? null,
    data: result["data"] ?? null,
    incomplete: false,
  });
}

async function streamAskMode(
  message: string,
  policy: ChatPolicy,
  res: Response,
  signal: AbortSignal,
  context: AdminDbConversationMessage[] = [],
): Promise<void> {
  const workload = classifyAiCoreWorkload(message);
  const routingMeta = {
    workload: workload.workload,
    costClass: workload.costClass,
  };

  const deterministic = await deterministicReply(message, workload);
  if (deterministic) {
    writeBufferedChatStream(res, deterministic);
    return;
  }

  const dataTool = await tryRunAiCoreDataTool(message);
  if (dataTool.matched) {
    writeBufferedChatStream(res, {
      kind: "answer",
      route: "DATA_TOOL",
      provider: null,
      model: null,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      estimatedCostUsd: 0,
      workload: "DATA_LOOKUP",
      costClass: "ZERO",
      reply: dataTool.reply,
      dataTool: dataTool.tool,
      data: dataTool.data,
      ...(dataTool.warning ? { warning: dataTool.warning } : {}),
    });
    return;
  }

  const adminDbQuery = await tryRunAdminDbQuery(message, policy, context).catch(
    (error: unknown) => ({
      kind: "answer",
      route: "ADMIN_DB_QUERY",
      provider: null,
      model: null,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      estimatedCostUsd: 0,
      workload: "DATA_LOOKUP",
      costClass: "ZERO",
      reply:
        "Admin DB Query dikenali tetapi query read-only gagal. Tidak ada perubahan data yang dilakukan.",
      warning: sanitizeAdminDbError(error),
    }),
  );
  if (adminDbQuery) {
    writeBufferedChatStream(res, adminDbQuery);
    return;
  }

  if (
    workload.workload === "CRITICAL_ACTION" ||
    workload.workload === "CODING" ||
    (policy !== "smart" && policy !== "cloud")
  ) {
    writeBufferedChatStream(res, await answerAskMode(message, policy, context));
    return;
  }

  const cloud = await resolveCloudSelection(workload.workload);
  if (!cloud.ok) {
    writeBufferedChatStream(res, await answerAskMode(message, policy, context));
    return;
  }

  const provider = String(cloud.selection.provider.slug).trim().toLowerCase();
  const model = String(cloud.selection.model.modelId).trim();
  let emittedText = false;

  writeStreamEvent(res, "meta", {
    route: "CLOUD",
    provider,
    model,
    ...routingMeta,
    streaming: true,
  });

  try {
    const result = await streamCloudChatNoFallback({
      providerSlug: provider,
      modelId: model,
      baseUrl:
        typeof cloud.selection.provider.baseUrl === "string"
          ? cloud.selection.provider.baseUrl
          : null,
      systemPrompt: ASK_SYSTEM_PROMPT,
      prompt: message,
      maxOutputTokens: Math.min(
        4_096,
        cloud.selection.maxOutputTokens || 1_600,
      ),
      temperature: 0,
      signal,
      observability: {
        conversationId: randomUUID(),
        agentName: "AI Core Chat",
        providerName: provider,
        modelName: model,
        requestType: "chat-stream",
        createdBy: "ai-core-chat",
      },
      onDelta: (text) => {
        if (!text || signal.aborted || res.writableEnded) return;
        emittedText = true;
        writeStreamEvent(res, "delta", { text });
      },
    });

    if (signal.aborted || res.writableEnded) return;

    writeStreamEvent(res, "done", {
      usage: result.usage,
      estimatedCostUsd: estimateSelectionCostUsd(
        cloud.selection,
        result.usage,
      ),
      latencyMs: result.latencyMs,
      providerRequestId: result.providerRequestId ?? null,
      incomplete: false,
    });
  } catch (error) {
    if (signal.aborted || res.writableEnded) return;

    const quarantined = await quarantineRetiredCloudModel(
      cloud.selection,
      error,
    );

    const failure =
      safeProviderFailure(error) || "Cloud streaming invocation failed.";

    if (!emittedText && quarantined) {
      const retry = await answerAskMode(message, policy, context);
      const retryModel =
        typeof retry["model"] === "string" ? retry["model"] : null;
      if (retryModel !== model || retry["route"] !== "CLOUD") {
        writeBufferedChatStream(res, {
          ...retry,
          warning:
            "Model cloud sebelumnya sudah retired/tidak tersedia dan telah dinonaktifkan otomatis. AI Core merutekan ulang request ini." +
            (typeof retry["warning"] === "string" && retry["warning"]
              ? " " + retry["warning"]
              : ""),
        });
        return;
      }
    }

    if (!emittedText) {
      const cloudFallback = await invokeCloudFallbackChain(cloud.selection, message);
      if (cloudFallback.ok) {
        writeStreamEvent(res, "meta", {
          route: "CLOUD_FALLBACK",
          provider: String(cloudFallback.selection.provider.slug),
          model: String(cloudFallback.selection.model.modelId),
          ...routingMeta,
          streaming: false,
          fallback: true,
        });
        writeBufferedChatStream(res, {
          kind: "answer",
          route: "CLOUD_FALLBACK",
          ...routingMeta,
          ...cloudFallback.result,
          warning:
            "Cloud primary sedang tidak tersedia; AI Core memakai cloud fallback " +
            String(cloudFallback.selection.provider.slug) + "/" +
            String(cloudFallback.selection.model.modelId) + ".",
        });
        return;
      }
    }

    if (!emittedText && policy === "smart") {
      const local = await resolveLocalSelection();
      if (local.ok) {
        try {
          writeStreamEvent(res, "meta", {
            route: "LOCAL",
            provider: String(local.selection.provider.slug),
            model: String(local.selection.model.modelId),
            ...routingMeta,
            streaming: false,
            fallback: true,
          });
          const result = await invokeChatModel(local.selection, message);
          writeBufferedChatStream(res, {
            kind: "answer",
            route: "LOCAL",
            ...routingMeta,
            ...result,
            warning:
              "Cloud route sedang tidak tersedia; AI Core memakai local fallback.",
          });
          return;
        } catch (localError) {
          writeBufferedChatStream(
            res,
            unavailableAskReply(
              "Cloud streaming dan local fallback sama-sama gagal menjawab.",
              [failure, safeProviderFailure(localError)]
                .filter(Boolean)
                .join(" | "),
              routingMeta,
            ),
          );
          return;
        }
      }

      writeBufferedChatStream(
        res,
        unavailableAskReply(
          "Cloud streaming gagal dan local fallback tidak tersedia.",
          [failure, local.message].filter(Boolean).join(" | "),
          routingMeta,
        ),
      );
      return;
    }

    if (!emittedText) {
      writeBufferedChatStream(
        res,
        unavailableAskReply(
          "Cloud AI sedang tidak dapat menjawab. Tidak ada tindakan sistem yang dijalankan.",
          failure,
          routingMeta,
        ),
      );
      return;
    }

    writeStreamEvent(res, "error", {
      message:
        "Streaming terhenti setelah sebagian jawaban diterima. Respons parsial dipertahankan.",
      warning: failure,
    });
    writeStreamEvent(res, "done", {
      usage: null,
      incomplete: true,
      warning: failure,
    });
  }
}


function remotePresetInstruction(preset: RemoteWorkerPreset): string {
  switch (preset) {
    case "build":
      return "Periksa repository lokal, tampilkan git status singkat dan commit HEAD, lalu jalankan build API server. Jangan mengubah atau menghapus file.";
    case "test":
      return "Periksa repository lokal, tampilkan git status singkat dan commit HEAD, lalu jalankan test API server. Jangan mengubah atau menghapus file.";
    case "review":
      return "Review perubahan repository lokal secara read-only dengan git status --short, git diff --name-only, dan git diff --check. Jangan mengubah atau menghapus file.";
    default:
      return "Periksa repository lokal secara read-only dengan git status --short, git rev-parse HEAD, node --version, dan pnpm --version. Jangan mengubah atau menghapus file.";
  }
}

async function maybeRunRemoteWorkerPreset(
  input: z.infer<typeof ChatRequest>,
  requestedPreset?: RemoteWorkerPreset | null,
): Promise<Record<string, unknown> | null> {
  const preset = requestedPreset ?? detectRemoteWorkerPreset(input.message);
  if (!preset) return null;

  if (
    input.repository &&
    !/^(travelintrips\/)?core-ai-foundation$/i.test(input.repository.trim())
  ) {
    return null;
  }

  const result = await runRemoteTrustedPowerShellTask({
    instruction: remotePresetInstruction(preset),
    requestedBy: "ai-core-chat-agent",
    modelId: "qwen2.5-coder:7b",
    timeoutMs: 180_000,
  });

  const execution = result["execution"] as Record<string, unknown> | undefined;
  return {
    kind: "agent_execution",
    route: "REMOTE_OLLAMA_POWERSHELL",
    provider: "ollama",
    model: "qwen2.5-coder:7b",
    usage: null,
    estimatedCostUsd: 0,
    preset,
    reply:
      `Remote worker operation '${preset}' selesai melalui trusted PowerShell policy.`,
    ...result,
    status: execution?.["status"] ?? null,
  };
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
      `Task ${task.taskNumber} dimulai. AI Core akan menganalisis repository, membagikan pekerjaan ke workstream/worker bila diperlukan, menjalankan langkah aman secara otomatis, dan berhenti pada critical approval seperti merge/deploy/database/security.`,
    taskId: task.id,
    taskNumber: task.taskNumber,
    status: "ANALYZING",
    workspaceUrl: `/coding-workspace/${task.id}`,
    autonomous: true,
  };
}

async function startExternalAgentWork(
  input: z.infer<typeof ChatRequest>,
  clientId: string,
): Promise<Record<string, unknown>> {
  const dispatched = await dispatchExternalAgentWork({
    clientId,
    instruction: input.message,
    source: "ai-core-chat",
  });

  const provider =
    clientId === OPENHANDS_AGENT_CLIENT_ID
      ? "openhands"
      : clientId === N8N_AGENT_CLIENT_ID
        ? "n8n"
        : "openclaw";

  return {
    kind: "external_agent",
    route: "EXTERNAL_AGENT",
    provider,
    model: null,
    usage: null,
    estimatedCostUsd: null,
    reply:
      `Perintah sudah diterima AI Core dan didelegasikan ke ${provider} melalui role-scoped work queue. Critical production actions tetap membutuhkan approval AI Core.`,
    commandId: dispatched.command.id,
    externalCommandId: dispatched.command.externalCommandId,
    status: dispatched.command.status,
    clientId,
    created: dispatched.created,
  };
}

async function runAdminDbMutationOperation(
  message: string,
): Promise<Record<string, unknown> | null> {
  const statement = extractExplicitAdminMutationSql(message);
  if (!statement) return null;

  const result = await executeAdminMutationSql(statement);
  return {
    kind: "execution",
    route: "ADMIN_DB_MUTATION",
    provider: "postgres",
    model: null,
    usage: null,
    estimatedCostUsd: 0,
    mutating: true,
    reply: renderAdminDbMutationResult(result),
    rowCount: result.rowCount,
    elapsedMs: result.elapsedMs,
  };
}

async function runInfrastructureOperation(
  message: string,
): Promise<Record<string, unknown> | null> {
  const operation = detectAiCoreInfrastructureOperation(message);
  if (!operation) return null;

  const result = await executeAiCoreInfrastructureOperation({
    operation,
    requestedBy: "ai-core-chat",
  });

  return {
    kind: "execution",
    route: "INFRA_CONTROL_PLANE",
    provider: result.provider,
    model: null,
    usage: null,
    estimatedCostUsd: 0,
    operation: result.operation,
    mutating: result.mutating,
    reply: result.reply,
    data: result.data,
  };
}

async function runAutoMode(
  input: z.infer<typeof ChatRequest>,
  executionInput: z.infer<typeof ChatRequest> = input,
): Promise<Record<string, unknown>> {
  const dbMutation = await runAdminDbMutationOperation(input.message);
  if (dbMutation) {
    return {
      ...dbMutation,
      workload: "DATA_MUTATION",
      costClass: "ZERO",
      autoRouted: true,
      dispatch: "DB_MUTATION",
      dispatchReason: "Explicit SQL mutation executed by the AI Core database executor.",
    };
  }

  const decision = classifyAiCoreChatDispatch(input.message);
  const routingMeta = {
    workload: decision.workload.workload,
    costClass: decision.workload.costClass,
    autoRouted: true,
    dispatch: decision.kind,
    dispatchReason: decision.reason,
  };

  if (decision.kind === "INFRA_OPERATION") {
    const result = await runInfrastructureOperation(input.message);
    if (result) return { ...result, ...routingMeta };
  }

  if (decision.kind === "CONTROL_PLANE") {
    const result = await startAgentTask(executionInput);
    return { ...result, ...routingMeta };
  }

  if (decision.kind === "EXTERNAL_AGENT") {
    const external = await startExternalAgentWork(executionInput, decision.externalAgentClientId ?? OPENCLAW_AGENT_CLIENT_ID);
    return { ...external, ...routingMeta };
  }

  if (decision.kind === "REMOTE_READONLY") {
    const remote = await maybeRunRemoteWorkerPreset(input, decision.preset);
    if (remote) return { ...remote, ...routingMeta };
  }

  const answer = await answerAskMode(executionInput.message, input.modelPolicy, input.context ?? [], input.message);
  return { ...routingMeta, ...answer };
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
    defaultMode: DEFAULT_AI_CORE_CHAT_MODE,
    modes: ["auto", "ask", "agent"],
    autoRouting: {
      answer: ["DETERMINISTIC", "CHAT", "REASONING"],
      remoteReadonly: ["REVIEW"],
      infrastructure: ["GCP", "HOSTINGER", "EXTERNAL_AGENT_STATUS"],
      externalAgent: ["EXPLICIT_OPENCLAW_DELEGATION"],
      controlPlane: ["CODING", "CRITICAL_ACTION"],
      criticalApprovalPreserved: true,
    },
    defaultModelPolicy: "smart",
    routing: ["NO_LLM", "DATA_TOOL", "SMART_CLOUD", "LOCAL", "CLOUD"],
    streaming: {
      enabled: true,
      endpoint: "/api/ai/core-chat/messages/stream",
      defaultPolicy: "smart",
      cloudProviders: ["openai", "anthropic", "gemini", "mistral"],
    },
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

router.get("/ai/core-chat/capabilities", async (_req, res): Promise<void> => {
  const registry = await getAiCoreCapabilityRegistrySnapshot();
  res.status(200).json(registry);
});

router.get("/ai/core-chat/databases/metadata", async (_req, res): Promise<void> => {
  try {
    const metadata = await inspectAdminDbSchemaCatalog();
    res.status(200).json({ ...metadata, secretsExposed: false });
  } catch (error) {
    res.status(503).json({ error: sanitizeAdminDbError(error), secretsExposed: false });
  }
});

router.get("/ai/core-chat/data-tools/readiness", async (_req, res): Promise<void> => {
  try {
    const readiness = await getAiCoreDataToolReadiness();
    res.status(200).json(readiness);
  } catch (error) {
    res.status(200).json({
      status: "degraded",
      tools: {
        sportCenterBookingLookup: {
          ready: false,
          missing: ["readiness_query_failed"],
        },
        tenantOutstandingSummary: {
          ready: false,
          missing: ["readiness_query_failed"],
        },
      },
      warning: safeProviderFailure(error),
    });
  }
});

router.post("/ai/core-chat/messages/stream", async (req, res): Promise<void> => {
  const parsed = ChatRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (parsed.data.mode !== "ask") {
    res.status(400).json({
      error: "Streaming endpoint is Ask Mode only; Agent Mode uses the control-plane endpoint.",
    });
    return;
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const controller = new AbortController();
  const abort = () => controller.abort();
  res.once("close", abort);

  try {
    await streamAskMode(
      parsed.data.message,
      parsed.data.modelPolicy,
      res,
      controller.signal,
      parsed.data.context ?? [],
    );
  } catch (error) {
    if (!controller.signal.aborted && !res.writableEnded) {
      writeStreamEvent(res, "error", {
        message: "AI Core Chat streaming request failed.",
        warning:
          error instanceof Error
            ? safeProviderFailure(error)
            : "Unknown streaming failure.",
      });
      writeStreamEvent(res, "done", {
        usage: null,
        incomplete: true,
      });
    }
  } finally {
    res.removeListener("close", abort);
    if (!res.writableEnded) res.end();
  }
});

router.post("/ai/core-chat/messages", async (req, res): Promise<void> => {
  const parsed = ChatRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const scope = {
      sessionId: parsed.data.conversationId ?? null,
      projectName: parsed.data.projectName ?? null,
      repository: parsed.data.repository ?? null,
      branch: parsed.data.branch ?? null,
    };
    await recordChatLearningEvent({
      role: "user",
      content: parsed.data.message,
      scope,
      metadata: { mode: parsed.data.mode, modelPolicy: parsed.data.modelPolicy },
    }).catch(() => undefined);
    await promoteExplicitChatLearning(parsed.data.message, scope).catch(() => false);

    const learnings = await retrieveChatLearnings(scope).catch(() => []);
    const effectiveInput = {
      ...parsed.data,
      message: appendLearningsToMessage(parsed.data.message, learnings),
    };

    const rawInput = parsed.data;
    const rawDispatch = classifyAiCoreChatDispatch(rawInput.message);
    const result =
      effectiveInput.mode === "agent"
        ? (await runAdminDbMutationOperation(rawInput.message)) ??
          (await runInfrastructureOperation(rawInput.message)) ??
          (rawDispatch.kind === "EXTERNAL_AGENT"
            ? await startExternalAgentWork(
                effectiveInput,
                rawDispatch.externalAgentClientId ?? OPENCLAW_AGENT_CLIENT_ID,
              )
            : null) ??
          (await maybeRunRemoteWorkerPreset(rawInput)) ??
          await startAgentTask(effectiveInput)
        : effectiveInput.mode === "ask"
          ? await answerAskMode(
              effectiveInput.message,
              effectiveInput.modelPolicy,
              effectiveInput.context ?? [],
              rawInput.message,
            )
          : await runAutoMode(rawInput, effectiveInput);

    const assistantContent =
      typeof result["reply"] === "string"
        ? result["reply"]
        : JSON.stringify({ kind: result["kind"], status: result["status"] ?? null });
    await recordChatLearningEvent({
      role: "assistant",
      content: assistantContent,
      scope,
      metadata: {
        route: result["route"] ?? null,
        kind: result["kind"] ?? null,
        status: result["status"] ?? null,
        taskId: result["taskId"] ?? null,
        learningCount: learnings.length,
      },
    }).catch(() => undefined);

    res
      .status(
        result["kind"] === "agent" || result["kind"] === "external_agent"
          ? 202
          : 200,
      )
      .json(result);
  } catch (error) {
    res.status(503).json({
      error: safeProviderFailure(error) || "AI Core Chat request failed.",
    });
  }
});

router.get("/ai/core-chat/external-work/:id", async (req, res): Promise<void> => {
  const commandId = TaskId.safeParse(req.params["id"]);
  if (!commandId.success) {
    res.status(400).json({ error: "Invalid external work id" });
    return;
  }

  const state = await getExternalAgentWorkState(commandId.data);
  if (!state) {
    res.status(404).json({ error: "External work item not found" });
    return;
  }

  res.json(state);
});

router.get("/ai/core-chat/tasks/:id/progress", async (req, res): Promise<void> => {
  const taskId = TaskId.safeParse(req.params["id"]);
  if (!taskId.success) {
    res.status(400).json({ error: "Invalid task id" });
    return;
  }

  const [task] = await withTransientDatabaseRetry(() => db
    .select()
    .from(aiCodingTasksTable)
    .where(eq(aiCodingTasksTable.id, taskId.data))
    .limit(1),
  { attempts: 3, baseDelayMs: 150 });

  if (!task) {
    res.status(404).json({ error: "Coding task not found" });
    return;
  }

  const [latestRun] = await withTransientDatabaseRetry(() => db
    .select()
    .from(aiCodingRunsTable)
    .where(eq(aiCodingRunsTable.taskId, task.id))
    .orderBy(desc(aiCodingRunsTable.startedAt))
    .limit(1),
  { attempts: 3, baseDelayMs: 150 });

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
