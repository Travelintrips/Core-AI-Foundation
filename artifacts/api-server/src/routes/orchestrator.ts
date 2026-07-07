import { Router } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  aiOrchestratorSessionsTable,
  aiModelsTable,
  aiProvidersTable,
  aiAgentsTable,
} from "@workspace/db";
import {
  OrchestratorExecuteBody,
  OrchestratorExecuteResponse,
  ListOrchestratorSessionsResponse,
  GetOrchestratorSessionParams,
  GetOrchestratorSessionResponse,
} from "@workspace/api-zod";
import { randomUUID } from "crypto";
import { logAudit } from "../services/aiAuditService.js";
import { executeAI } from "../services/aiExecutionService.js";
import { routeToModel, getFallbackModels } from "../services/aiModelRouter.js";
import { getProviderApiKey } from "../services/aiSecretService.js";

const router = Router();

router.post("/ai/orchestrator/execute", async (req, res): Promise<void> => {
  const parsed = OrchestratorExecuteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { prompt, modelId, systemPrompt, sessionId, agentId, parameters } = parsed.data;
  const activeSessionId = sessionId ?? randomUUID();

  // ── Resolve model + provider ──────────────────────────────────────────────
  let model: typeof aiModelsTable.$inferSelect | null = null;
  let provider: typeof aiProvidersTable.$inferSelect | null = null;
  let autoRouted = false;

  if (modelId != null) {
    // Manual model selection
    const [row] = await db
      .select({ model: aiModelsTable, provider: aiProvidersTable })
      .from(aiModelsTable)
      .leftJoin(aiProvidersTable, eq(aiModelsTable.providerId, aiProvidersTable.id))
      .where(eq(aiModelsTable.id, modelId));

    if (!row) {
      res.status(400).json({ error: "Selected model not found" });
      return;
    }
    if (!row.model.isActive) {
      res.status(400).json({ error: `Model '${row.model.name}' is inactive` });
      return;
    }
    if (!row.provider?.isActive) {
      res.status(400).json({ error: `Provider '${row.provider?.name ?? "unknown"}' is inactive` });
      return;
    }
    if (row.provider && !getProviderApiKey(row.provider.slug)) {
      res.status(400).json({
        error: `API key not configured for provider '${row.provider.name}'. Set the required environment variable.`,
      });
      return;
    }

    model = row.model;
    provider = row.provider;
  } else {
    // Auto-route to best available model
    const routed = await routeToModel(prompt);
    if (routed) {
      model = routed.model;
      provider = routed.provider;
      autoRouted = true;
    }
  }

  if (!model || !provider) {
    res.status(503).json({
      error:
        "No active model with a configured API key is available. Add providers and models in the Registry, then set their API key environment variables.",
    });
    return;
  }

  // ── Load agent system prompt if agentId is provided ───────────────────────
  // agentId from API schema is string|null (OpenAPI style); parse to int for DB
  let effectiveSystemPrompt = systemPrompt ?? null;
  const agentDbId = agentId != null ? parseInt(agentId, 10) : null;
  if (agentDbId != null && !Number.isNaN(agentDbId) && !effectiveSystemPrompt) {
    const [agent] = await db
      .select()
      .from(aiAgentsTable)
      .where(eq(aiAgentsTable.id, agentDbId));
    if (agent?.metadata) {
      const meta = agent.metadata as Record<string, unknown>;
      if (typeof meta.systemPrompt === "string") {
        effectiveSystemPrompt = meta.systemPrompt;
      }
    }
  }

  // ── Resolve execution parameters ──────────────────────────────────────────
  const params = (parameters ?? {}) as Record<string, unknown>;
  const temperature = typeof params.temperature === "number" ? params.temperature : null;
  const maxTokens = typeof params.maxTokens === "number" ? params.maxTokens : null;

  // ── Execute AI call (with auto-route fallback on failure) ─────────────────
  let result: import("../services/aiExecutionService.js").ExecutionOutput;
  let usedModel = model;
  let usedProvider = provider;

  try {
    result = await executeAI({
      prompt,
      systemPrompt: effectiveSystemPrompt,
      model,
      provider,
      temperature,
      maxTokens,
    });
  } catch (primaryErr) {
    await logAudit("orchestrator", "execute_failed", activeSessionId, "session", "failure", {
      modelId: model.id,
      modelName: model.name,
      error: String(primaryErr),
    });

    if (!autoRouted) {
      res.status(502).json({ error: `AI execution failed: ${String(primaryErr)}` });
      return;
    }

    // Auto-routed: try fallback models
    const fallbacks = await getFallbackModels(model.id);
    let fallbackResult: import("../services/aiExecutionService.js").ExecutionOutput | null = null;

    for (const fallback of fallbacks) {
      try {
        fallbackResult = await executeAI({
          prompt,
          systemPrompt: effectiveSystemPrompt,
          model: fallback.model,
          provider: fallback.provider,
          temperature,
          maxTokens,
        });
        usedModel = fallback.model;
        usedProvider = fallback.provider;
        break;
      } catch {
        // continue to next fallback
      }
    }

    if (!fallbackResult) {
      await logAudit("orchestrator", "all_fallbacks_failed", activeSessionId, "session", "failure", {
        primaryModel: model.name,
        fallbackCount: fallbacks.length,
      });
      res.status(502).json({
        error: `AI execution failed and all fallbacks exhausted. Primary error: ${String(primaryErr)}`,
      });
      return;
    }

    result = fallbackResult;
  }

  // ── Upsert session ────────────────────────────────────────────────────────
  const [existing] = await db
    .select()
    .from(aiOrchestratorSessionsTable)
    .where(eq(aiOrchestratorSessionsTable.sessionId, activeSessionId));

  if (existing) {
    await db
      .update(aiOrchestratorSessionsTable)
      .set({
        totalTokens: existing.totalTokens + result.tokensUsed,
        totalRequests: existing.totalRequests + 1,
        lastModelUsed: usedModel.modelId,
      })
      .where(eq(aiOrchestratorSessionsTable.sessionId, activeSessionId));
  } else {
    await db.insert(aiOrchestratorSessionsTable).values({
      sessionId: activeSessionId,
      agentId: agentId ?? null,
      totalTokens: result.tokensUsed,
      totalRequests: 1,
      lastModelUsed: usedModel.modelId,
    });
  }

  await logAudit("orchestrator", "execute", activeSessionId, "session", "success", {
    modelId: usedModel.id,
    modelName: usedModel.modelId,
    providerSlug: usedProvider.slug,
    tokensUsed: result.tokensUsed,
    latencyMs: result.latencyMs,
    autoRouted,
  });

  res.json(
    OrchestratorExecuteResponse.parse({
      sessionId: activeSessionId,
      content: result.content,
      modelUsed: usedModel.modelId,
      providerId: usedProvider.id,
      tokensUsed: result.tokensUsed,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      latencyMs: result.latencyMs,
      createdAt: new Date().toISOString(),
    }),
  );
});

router.get("/ai/orchestrator/sessions", async (_req, res): Promise<void> => {
  const sessions = await db
    .select()
    .from(aiOrchestratorSessionsTable)
    .orderBy(aiOrchestratorSessionsTable.createdAt);
  res.json(ListOrchestratorSessionsResponse.parse(sessions));
});

router.get("/ai/orchestrator/sessions/:id", async (req, res): Promise<void> => {
  const params = GetOrchestratorSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [session] = await db
    .select()
    .from(aiOrchestratorSessionsTable)
    .where(eq(aiOrchestratorSessionsTable.id, params.data.id));
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json(GetOrchestratorSessionResponse.parse(session));
});

/** Quick smoke-test endpoint — returns 200 with service status (no AI call made). */
router.post("/ai/orchestrator/test", async (_req, res): Promise<void> => {
  const { getAllActiveModels } = await import("../services/aiModelService.js");
  const { getProviderApiKey: getKey } = await import("../services/aiSecretService.js");
  const models = await getAllActiveModels();
  const available = models.filter(({ provider }) => !!getKey(provider.slug));

  res.json({
    status: available.length > 0 ? "ready" : "no_models",
    availableModels: available.map(({ model, provider }) => ({
      modelId: model.modelId,
      provider: provider.slug,
    })),
    totalActive: models.length,
    withApiKey: available.length,
  });
});

export default router;
