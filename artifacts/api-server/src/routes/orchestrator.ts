import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, aiOrchestratorSessionsTable, aiModelsTable, aiProvidersTable, aiAuditLogsTable } from "@workspace/db";
import {
  OrchestratorExecuteBody,
  OrchestratorExecuteResponse,
  ListOrchestratorSessionsResponse,
  GetOrchestratorSessionParams,
  GetOrchestratorSessionResponse,
} from "@workspace/api-zod";
import { randomUUID } from "crypto";

const router = Router();

async function logAudit(module: string, action: string, resourceId: string, resourceType: string, status: "success" | "failure" = "success", details?: object) {
  await db.insert(aiAuditLogsTable).values({ module, action, resourceId, resourceType, status, details: details ?? null });
}

router.post("/ai/orchestrator/execute", async (req, res): Promise<void> => {
  const parsed = OrchestratorExecuteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { prompt, modelId, systemPrompt, sessionId, agentId, parameters } = parsed.data;
  const startTime = Date.now();

  // Find model or pick first active one
  let model = null;
  let provider = null;

  if (modelId != null) {
    const [m] = await db
      .select({ model: aiModelsTable, provider: aiProvidersTable })
      .from(aiModelsTable)
      .leftJoin(aiProvidersTable, eq(aiModelsTable.providerId, aiProvidersTable.id))
      .where(eq(aiModelsTable.id, modelId));
    if (m) { model = m.model; provider = m.provider; }
  }

  if (!model) {
    const [m] = await db
      .select({ model: aiModelsTable, provider: aiProvidersTable })
      .from(aiModelsTable)
      .leftJoin(aiProvidersTable, eq(aiModelsTable.providerId, aiProvidersTable.id))
      .where(eq(aiModelsTable.isActive, true));
    if (m) { model = m.model; provider = m.provider; }
  }

  const activeSessionId = sessionId ?? randomUUID();
  const latencyMs = Date.now() - startTime + Math.floor(Math.random() * 800 + 200);

  // Simulate token usage (in a real implementation, call the actual provider API)
  const promptTokens = Math.ceil(prompt.length / 4);
  const completionTokens = Math.floor(Math.random() * 200 + 50);
  const tokensUsed = promptTokens + completionTokens;

  // Simulated response (replace with real API call to provider)
  const simulatedContent = `[Orchestrator] Model: ${model?.modelId ?? "none"} | Provider: ${provider?.name ?? "none"} | Tokens: ${tokensUsed} | Response to: "${prompt.slice(0, 80)}..."`;

  // Upsert session
  const existing = await db.select().from(aiOrchestratorSessionsTable).where(eq(aiOrchestratorSessionsTable.sessionId, activeSessionId));
  if (existing.length > 0) {
    await db.update(aiOrchestratorSessionsTable)
      .set({
        totalTokens: existing[0].totalTokens + tokensUsed,
        totalRequests: existing[0].totalRequests + 1,
        lastModelUsed: model?.modelId ?? null,
      })
      .where(eq(aiOrchestratorSessionsTable.sessionId, activeSessionId));
  } else {
    await db.insert(aiOrchestratorSessionsTable).values({
      sessionId: activeSessionId,
      agentId: agentId ?? null,
      totalTokens: tokensUsed,
      totalRequests: 1,
      lastModelUsed: model?.modelId ?? null,
    });
  }

  await logAudit("orchestrator", "execute", activeSessionId, "session", "success", { modelId: model?.id, tokensUsed });

  const result = {
    sessionId: activeSessionId,
    content: simulatedContent,
    modelUsed: model?.modelId ?? "no-model",
    providerId: provider?.id ?? 0,
    tokensUsed,
    promptTokens,
    completionTokens,
    latencyMs,
    createdAt: new Date().toISOString(),
  };

  res.json(OrchestratorExecuteResponse.parse(result));
});

router.get("/ai/orchestrator/sessions", async (_req, res): Promise<void> => {
  const sessions = await db.select().from(aiOrchestratorSessionsTable).orderBy(aiOrchestratorSessionsTable.createdAt);
  res.json(ListOrchestratorSessionsResponse.parse(sessions));
});

router.get("/ai/orchestrator/sessions/:id", async (req, res): Promise<void> => {
  const params = GetOrchestratorSessionParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [session] = await db.select().from(aiOrchestratorSessionsTable).where(eq(aiOrchestratorSessionsTable.id, params.data.id));
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  res.json(GetOrchestratorSessionResponse.parse(session));
});

export default router;
