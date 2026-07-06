import { Router } from "express";
import { eq, and } from "drizzle-orm";
import {
  db,
  aiAgentsTable,
  aiAgentCapabilitiesTable,
  aiProvidersTable,
  aiModelsTable,
  aiAuditLogsTable,
} from "@workspace/db";
import {
  ListAgentsResponse,
  CreateAgentBody,
  CreateAgentResponse,
  GetAgentParams,
  GetAgentResponse,
  UpdateAgentParams,
  UpdateAgentBody,
  UpdateAgentResponse,
  DeleteAgentParams,
  DeleteAgentResponse,
  ListAgentCapabilitiesParams,
  ListAgentCapabilitiesResponse,
  AddAgentCapabilityParams,
  AddAgentCapabilityBody,
  AddAgentCapabilityResponse,
  DeleteAgentCapabilityParams,
  DeleteAgentCapabilityResponse,
} from "@workspace/api-zod";

const router = Router();

async function logAudit(
  module: string,
  action: string,
  resourceId: string,
  resourceType: string,
  status: "success" | "failure" = "success",
  details?: object,
) {
  await db
    .insert(aiAuditLogsTable)
    .values({ module, action, resourceId, resourceType, status, details: details ?? null });
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function fetchAgentWithJoins(id: number) {
  const [agent] = await db
    .select({
      id: aiAgentsTable.id,
      name: aiAgentsTable.name,
      slug: aiAgentsTable.slug,
      role: aiAgentsTable.role,
      description: aiAgentsTable.description,
      providerId: aiAgentsTable.providerId,
      providerName: aiProvidersTable.name,
      modelId: aiAgentsTable.modelId,
      modelName: aiModelsTable.name,
      priority: aiAgentsTable.priority,
      temperature: aiAgentsTable.temperature,
      maxTokens: aiAgentsTable.maxTokens,
      status: aiAgentsTable.status,
      allowedTools: aiAgentsTable.allowedTools,
      knowledgeBaseId: aiAgentsTable.knowledgeBaseId,
      version: aiAgentsTable.version,
      owner: aiAgentsTable.owner,
      metadata: aiAgentsTable.metadata,
      createdAt: aiAgentsTable.createdAt,
      updatedAt: aiAgentsTable.updatedAt,
    })
    .from(aiAgentsTable)
    .leftJoin(aiProvidersTable, eq(aiAgentsTable.providerId, aiProvidersTable.id))
    .leftJoin(aiModelsTable, eq(aiAgentsTable.modelId, aiModelsTable.id))
    .where(eq(aiAgentsTable.id, id));
  return agent ?? null;
}

function normalizeAgent(a: NonNullable<Awaited<ReturnType<typeof fetchAgentWithJoins>>>) {
  return {
    ...a,
    temperature: a.temperature != null ? Number(a.temperature) : null,
  };
}

// ── Agents CRUD ────────────────────────────────────────────────────────────

router.get("/ai/agents", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: aiAgentsTable.id,
      name: aiAgentsTable.name,
      slug: aiAgentsTable.slug,
      role: aiAgentsTable.role,
      description: aiAgentsTable.description,
      providerId: aiAgentsTable.providerId,
      providerName: aiProvidersTable.name,
      modelId: aiAgentsTable.modelId,
      modelName: aiModelsTable.name,
      priority: aiAgentsTable.priority,
      temperature: aiAgentsTable.temperature,
      maxTokens: aiAgentsTable.maxTokens,
      status: aiAgentsTable.status,
      allowedTools: aiAgentsTable.allowedTools,
      knowledgeBaseId: aiAgentsTable.knowledgeBaseId,
      version: aiAgentsTable.version,
      owner: aiAgentsTable.owner,
      metadata: aiAgentsTable.metadata,
      createdAt: aiAgentsTable.createdAt,
      updatedAt: aiAgentsTable.updatedAt,
    })
    .from(aiAgentsTable)
    .leftJoin(aiProvidersTable, eq(aiAgentsTable.providerId, aiProvidersTable.id))
    .leftJoin(aiModelsTable, eq(aiAgentsTable.modelId, aiModelsTable.id))
    .orderBy(aiAgentsTable.priority, aiAgentsTable.name);

  res.json(
    ListAgentsResponse.parse(rows.map((a) => ({ ...a, temperature: a.temperature != null ? Number(a.temperature) : null }))),
  );
});

router.post("/ai/agents", async (req, res): Promise<void> => {
  const parsed = CreateAgentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;
  const [row] = await db
    .insert(aiAgentsTable)
    .values({
      name: d.name,
      slug: d.slug,
      role: d.role,
      description: d.description ?? null,
      providerId: d.providerId ?? null,
      modelId: d.modelId ?? null,
      priority: d.priority ?? 100,
      temperature: d.temperature != null ? String(d.temperature) : null,
      maxTokens: d.maxTokens ?? null,
      status: d.status ?? "active",
      allowedTools: d.allowedTools ?? [],
      knowledgeBaseId: d.knowledgeBaseId ?? null,
      version: d.version ?? "1.0.0",
      owner: d.owner ?? null,
      metadata: d.metadata ?? null,
    })
    .returning();
  await logAudit("agents", "create_agent", String(row.id), "agent");
  const full = await fetchAgentWithJoins(row.id);
  res.status(201).json(CreateAgentResponse.parse(normalizeAgent(full!)));
});

router.get("/ai/agents/:id", async (req, res): Promise<void> => {
  const params = GetAgentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const agent = await fetchAgentWithJoins(params.data.id);
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  res.json(GetAgentResponse.parse(normalizeAgent(agent)));
});

router.patch("/ai/agents/:id", async (req, res): Promise<void> => {
  const params = UpdateAgentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateAgentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const d = parsed.data;
  const updateData: Record<string, unknown> = {};
  if (d.name !== undefined) updateData.name = d.name;
  if (d.slug !== undefined) updateData.slug = d.slug;
  if (d.role !== undefined) updateData.role = d.role;
  if (d.description !== undefined) updateData.description = d.description;
  if (d.providerId !== undefined) updateData.providerId = d.providerId;
  if (d.modelId !== undefined) updateData.modelId = d.modelId;
  if (d.priority !== undefined) updateData.priority = d.priority;
  if (d.temperature !== undefined) updateData.temperature = d.temperature != null ? String(d.temperature) : null;
  if (d.maxTokens !== undefined) updateData.maxTokens = d.maxTokens;
  if (d.status !== undefined) updateData.status = d.status;
  if (d.allowedTools !== undefined) updateData.allowedTools = d.allowedTools;
  if (d.knowledgeBaseId !== undefined) updateData.knowledgeBaseId = d.knowledgeBaseId;
  if (d.version !== undefined) updateData.version = d.version;
  if (d.owner !== undefined) updateData.owner = d.owner;
  if (d.metadata !== undefined) updateData.metadata = d.metadata;
  const [updated] = await db
    .update(aiAgentsTable)
    .set(updateData)
    .where(eq(aiAgentsTable.id, params.data.id))
    .returning();
  if (!updated) { res.status(404).json({ error: "Agent not found" }); return; }
  await logAudit("agents", "update_agent", String(updated.id), "agent");
  const full = await fetchAgentWithJoins(updated.id);
  res.json(UpdateAgentResponse.parse(normalizeAgent(full!)));
});

router.delete("/ai/agents/:id", async (req, res): Promise<void> => {
  const params = DeleteAgentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [deleted] = await db.delete(aiAgentsTable).where(eq(aiAgentsTable.id, params.data.id)).returning();
  if (!deleted) { res.status(404).json({ error: "Agent not found" }); return; }
  await logAudit("agents", "delete_agent", String(params.data.id), "agent");
  res.sendStatus(204);
  DeleteAgentResponse.parse(undefined);
});

// ── Capabilities ───────────────────────────────────────────────────────────

router.get("/ai/agents/:id/capabilities", async (req, res): Promise<void> => {
  const params = ListAgentCapabilitiesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const caps = await db
    .select()
    .from(aiAgentCapabilitiesTable)
    .where(eq(aiAgentCapabilitiesTable.agentId, params.data.id))
    .orderBy(aiAgentCapabilitiesTable.sortOrder, aiAgentCapabilitiesTable.name);
  res.json(ListAgentCapabilitiesResponse.parse(caps));
});

router.post("/ai/agents/:id/capabilities", async (req, res): Promise<void> => {
  const params = AddAgentCapabilityParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = AddAgentCapabilityBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [cap] = await db
    .insert(aiAgentCapabilitiesTable)
    .values({
      agentId: params.data.id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      category: parsed.data.category ?? null,
      sortOrder: parsed.data.sortOrder ?? 0,
    })
    .returning();
  await logAudit("agents", "add_capability", String(cap.id), "agent_capability");
  res.status(201).json(AddAgentCapabilityResponse.parse(cap));
});

router.delete("/ai/agents/:id/capabilities/:capId", async (req, res): Promise<void> => {
  const params = DeleteAgentCapabilityParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [deleted] = await db
    .delete(aiAgentCapabilitiesTable)
    .where(
      and(
        eq(aiAgentCapabilitiesTable.id, params.data.capId),
        eq(aiAgentCapabilitiesTable.agentId, params.data.id),
      ),
    )
    .returning();
  if (!deleted) { res.status(404).json({ error: "Capability not found" }); return; }
  await logAudit("agents", "delete_capability", String(params.data.capId), "agent_capability");
  res.sendStatus(204);
  DeleteAgentCapabilityResponse.parse(undefined);
});

export default router;
