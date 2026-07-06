import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, aiProvidersTable, aiModelsTable } from "@workspace/db";
import {
  CreateProviderBody,
  UpdateProviderBody,
  GetProviderParams,
  UpdateProviderParams,
  DeleteProviderParams,
  ListProvidersResponse,
  CreateProviderResponse,
  GetProviderResponse,
  UpdateProviderResponse,
  DeleteProviderResponse,
  ListModelsQueryParams,
  CreateModelBody,
  UpdateModelBody,
  GetModelParams,
  UpdateModelParams,
  DeleteModelParams,
  ListModelsResponse,
  CreateModelResponse,
  GetModelResponse,
  UpdateModelResponse,
  DeleteModelResponse,
} from "@workspace/api-zod";
import { aiAuditLogsTable } from "@workspace/db";

const router = Router();

async function logAudit(module: string, action: string, resourceId: string, resourceType: string, status: "success" | "failure" = "success", details?: object) {
  await db.insert(aiAuditLogsTable).values({ module, action, resourceId, resourceType, status, details: details ?? null });
}

// ── Providers ──────────────────────────────────────────────────────────────

router.get("/ai/providers", async (_req, res): Promise<void> => {
  const providers = await db.select().from(aiProvidersTable).orderBy(aiProvidersTable.createdAt);
  res.json(ListProvidersResponse.parse(providers));
});

router.post("/ai/providers", async (req, res): Promise<void> => {
  const parsed = CreateProviderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [provider] = await db.insert(aiProvidersTable).values({
    name: parsed.data.name,
    slug: parsed.data.slug,
    baseUrl: parsed.data.baseUrl,
    apiKeyEnvVar: parsed.data.apiKeyEnvVar ?? null,
    isActive: parsed.data.isActive ?? true,
    metadata: parsed.data.metadata ?? null,
  }).returning();
  await logAudit("registry", "create_provider", String(provider.id), "provider");
  res.status(201).json(CreateProviderResponse.parse(provider));
});

router.get("/ai/providers/:id", async (req, res): Promise<void> => {
  const params = GetProviderParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [provider] = await db.select().from(aiProvidersTable).where(eq(aiProvidersTable.id, params.data.id));
  if (!provider) { res.status(404).json({ error: "Provider not found" }); return; }
  res.json(GetProviderResponse.parse(provider));
});

router.patch("/ai/providers/:id", async (req, res): Promise<void> => {
  const params = UpdateProviderParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateProviderBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const updateData: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.baseUrl !== undefined) updateData.baseUrl = parsed.data.baseUrl;
  if (parsed.data.apiKeyEnvVar !== undefined) updateData.apiKeyEnvVar = parsed.data.apiKeyEnvVar;
  if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;
  if (parsed.data.metadata !== undefined) updateData.metadata = parsed.data.metadata;
  const [provider] = await db.update(aiProvidersTable).set(updateData).where(eq(aiProvidersTable.id, params.data.id)).returning();
  if (!provider) { res.status(404).json({ error: "Provider not found" }); return; }
  await logAudit("registry", "update_provider", String(provider.id), "provider");
  res.json(UpdateProviderResponse.parse(provider));
});

router.delete("/ai/providers/:id", async (req, res): Promise<void> => {
  const params = DeleteProviderParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [provider] = await db.delete(aiProvidersTable).where(eq(aiProvidersTable.id, params.data.id)).returning();
  if (!provider) { res.status(404).json({ error: "Provider not found" }); return; }
  await logAudit("registry", "delete_provider", String(params.data.id), "provider");
  res.sendStatus(204);
  DeleteProviderResponse.parse(undefined);
});

// ── Models ─────────────────────────────────────────────────────────────────

router.get("/ai/models", async (req, res): Promise<void> => {
  const query = ListModelsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }

  const models = await db
    .select({
      id: aiModelsTable.id,
      providerId: aiModelsTable.providerId,
      providerName: aiProvidersTable.name,
      name: aiModelsTable.name,
      modelId: aiModelsTable.modelId,
      capabilities: aiModelsTable.capabilities,
      contextWindow: aiModelsTable.contextWindow,
      maxOutputTokens: aiModelsTable.maxOutputTokens,
      costPerInputToken: aiModelsTable.costPerInputToken,
      costPerOutputToken: aiModelsTable.costPerOutputToken,
      isActive: aiModelsTable.isActive,
      metadata: aiModelsTable.metadata,
      createdAt: aiModelsTable.createdAt,
      updatedAt: aiModelsTable.updatedAt,
    })
    .from(aiModelsTable)
    .leftJoin(aiProvidersTable, eq(aiModelsTable.providerId, aiProvidersTable.id))
    .orderBy(aiModelsTable.createdAt);

  const filtered = query.data.providerId != null
    ? models.filter(m => m.providerId === query.data.providerId)
    : models;

  res.json(ListModelsResponse.parse(filtered.map(m => ({
    ...m,
    costPerInputToken: m.costPerInputToken != null ? Number(m.costPerInputToken) : null,
    costPerOutputToken: m.costPerOutputToken != null ? Number(m.costPerOutputToken) : null,
  }))));
});

router.post("/ai/models", async (req, res): Promise<void> => {
  const parsed = CreateModelBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [model] = await db.insert(aiModelsTable).values({
    providerId: parsed.data.providerId,
    name: parsed.data.name,
    modelId: parsed.data.modelId,
    capabilities: parsed.data.capabilities,
    contextWindow: parsed.data.contextWindow ?? null,
    maxOutputTokens: parsed.data.maxOutputTokens ?? null,
    costPerInputToken: parsed.data.costPerInputToken != null ? String(parsed.data.costPerInputToken) : null,
    costPerOutputToken: parsed.data.costPerOutputToken != null ? String(parsed.data.costPerOutputToken) : null,
    isActive: parsed.data.isActive ?? true,
    metadata: parsed.data.metadata ?? null,
  }).returning();
  await logAudit("registry", "create_model", String(model.id), "model");
  res.status(201).json(CreateModelResponse.parse({ ...model, costPerInputToken: model.costPerInputToken != null ? Number(model.costPerInputToken) : null, costPerOutputToken: model.costPerOutputToken != null ? Number(model.costPerOutputToken) : null, providerName: null }));
});

router.get("/ai/models/:id", async (req, res): Promise<void> => {
  const params = GetModelParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [model] = await db
    .select({ id: aiModelsTable.id, providerId: aiModelsTable.providerId, providerName: aiProvidersTable.name, name: aiModelsTable.name, modelId: aiModelsTable.modelId, capabilities: aiModelsTable.capabilities, contextWindow: aiModelsTable.contextWindow, maxOutputTokens: aiModelsTable.maxOutputTokens, costPerInputToken: aiModelsTable.costPerInputToken, costPerOutputToken: aiModelsTable.costPerOutputToken, isActive: aiModelsTable.isActive, metadata: aiModelsTable.metadata, createdAt: aiModelsTable.createdAt, updatedAt: aiModelsTable.updatedAt })
    .from(aiModelsTable)
    .leftJoin(aiProvidersTable, eq(aiModelsTable.providerId, aiProvidersTable.id))
    .where(eq(aiModelsTable.id, params.data.id));
  if (!model) { res.status(404).json({ error: "Model not found" }); return; }
  res.json(GetModelResponse.parse({ ...model, costPerInputToken: model.costPerInputToken != null ? Number(model.costPerInputToken) : null, costPerOutputToken: model.costPerOutputToken != null ? Number(model.costPerOutputToken) : null }));
});

router.patch("/ai/models/:id", async (req, res): Promise<void> => {
  const params = UpdateModelParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateModelBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const updateData: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.capabilities !== undefined) updateData.capabilities = parsed.data.capabilities;
  if (parsed.data.contextWindow !== undefined) updateData.contextWindow = parsed.data.contextWindow;
  if (parsed.data.maxOutputTokens !== undefined) updateData.maxOutputTokens = parsed.data.maxOutputTokens;
  if (parsed.data.costPerInputToken !== undefined) updateData.costPerInputToken = parsed.data.costPerInputToken != null ? String(parsed.data.costPerInputToken) : null;
  if (parsed.data.costPerOutputToken !== undefined) updateData.costPerOutputToken = parsed.data.costPerOutputToken != null ? String(parsed.data.costPerOutputToken) : null;
  if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;
  if (parsed.data.metadata !== undefined) updateData.metadata = parsed.data.metadata;
  const [model] = await db.update(aiModelsTable).set(updateData).where(eq(aiModelsTable.id, params.data.id)).returning();
  if (!model) { res.status(404).json({ error: "Model not found" }); return; }
  await logAudit("registry", "update_model", String(model.id), "model");
  res.json(UpdateModelResponse.parse({ ...model, costPerInputToken: model.costPerInputToken != null ? Number(model.costPerInputToken) : null, costPerOutputToken: model.costPerOutputToken != null ? Number(model.costPerOutputToken) : null, providerName: null }));
});

router.delete("/ai/models/:id", async (req, res): Promise<void> => {
  const params = DeleteModelParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [model] = await db.delete(aiModelsTable).where(eq(aiModelsTable.id, params.data.id)).returning();
  if (!model) { res.status(404).json({ error: "Model not found" }); return; }
  await logAudit("registry", "delete_model", String(params.data.id), "model");
  res.sendStatus(204);
  DeleteModelResponse.parse(undefined);
});

export default router;
