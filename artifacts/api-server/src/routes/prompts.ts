import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, aiPromptsTable, aiPromptVersionsTable, aiAuditLogsTable } from "@workspace/db";
import {
  CreatePromptBody,
  UpdatePromptBody,
  GetPromptParams,
  UpdatePromptParams,
  DeletePromptParams,
  ListPromptsQueryParams,
  ListPromptsResponse,
  CreatePromptResponse,
  GetPromptResponse,
  UpdatePromptResponse,
  DeletePromptResponse,
  ListPromptVersionsParams,
  ListPromptVersionsResponse,
  CreatePromptVersionParams,
  CreatePromptVersionBody,
  CreatePromptVersionResponse,
} from "@workspace/api-zod";

const router = Router();

async function logAudit(module: string, action: string, resourceId: string, resourceType: string, status: "success" | "failure" = "success") {
  await db.insert(aiAuditLogsTable).values({ module, action, resourceId, resourceType, status, details: null });
}

router.get("/ai/prompts", async (req, res): Promise<void> => {
  const query = ListPromptsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const prompts = await db.select().from(aiPromptsTable).orderBy(aiPromptsTable.createdAt);
  const filtered = query.data.category != null ? prompts.filter(p => p.category === query.data.category) : prompts;
  res.json(ListPromptsResponse.parse(filtered));
});

router.post("/ai/prompts", async (req, res): Promise<void> => {
  const parsed = CreatePromptBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [prompt] = await db.insert(aiPromptsTable).values({
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    content: parsed.data.content,
    category: parsed.data.category,
    variables: parsed.data.variables ?? [],
    tags: parsed.data.tags ?? [],
    isActive: parsed.data.isActive ?? true,
  }).returning();
  // Record initial version
  await db.insert(aiPromptVersionsTable).values({ promptId: prompt.id, version: 1, content: prompt.content, changeNote: "Initial version" });
  await logAudit("prompt", "create_prompt", String(prompt.id), "prompt");
  res.status(201).json(CreatePromptResponse.parse(prompt));
});

router.get("/ai/prompts/:id", async (req, res): Promise<void> => {
  const params = GetPromptParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [prompt] = await db.select().from(aiPromptsTable).where(eq(aiPromptsTable.id, params.data.id));
  if (!prompt) { res.status(404).json({ error: "Prompt not found" }); return; }
  res.json(GetPromptResponse.parse(prompt));
});

router.patch("/ai/prompts/:id", async (req, res): Promise<void> => {
  const params = UpdatePromptParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdatePromptBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const updateData: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if (parsed.data.content !== undefined) updateData.content = parsed.data.content;
  if (parsed.data.category !== undefined) updateData.category = parsed.data.category;
  if (parsed.data.variables !== undefined) updateData.variables = parsed.data.variables;
  if (parsed.data.tags !== undefined) updateData.tags = parsed.data.tags;
  if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;
  const [prompt] = await db.update(aiPromptsTable).set(updateData).where(eq(aiPromptsTable.id, params.data.id)).returning();
  if (!prompt) { res.status(404).json({ error: "Prompt not found" }); return; }
  await logAudit("prompt", "update_prompt", String(prompt.id), "prompt");
  res.json(UpdatePromptResponse.parse(prompt));
});

router.delete("/ai/prompts/:id", async (req, res): Promise<void> => {
  const params = DeletePromptParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [prompt] = await db.delete(aiPromptsTable).where(eq(aiPromptsTable.id, params.data.id)).returning();
  if (!prompt) { res.status(404).json({ error: "Prompt not found" }); return; }
  await logAudit("prompt", "delete_prompt", String(params.data.id), "prompt");
  res.sendStatus(204);
  DeletePromptResponse.parse(undefined);
});

router.get("/ai/prompts/:id/versions", async (req, res): Promise<void> => {
  const params = ListPromptVersionsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const versions = await db.select().from(aiPromptVersionsTable).where(eq(aiPromptVersionsTable.promptId, params.data.id)).orderBy(aiPromptVersionsTable.version);
  res.json(ListPromptVersionsResponse.parse(versions));
});

router.post("/ai/prompts/:id/versions", async (req, res): Promise<void> => {
  const params = CreatePromptVersionParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = CreatePromptVersionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [prompt] = await db.select().from(aiPromptsTable).where(eq(aiPromptsTable.id, params.data.id));
  if (!prompt) { res.status(404).json({ error: "Prompt not found" }); return; }
  const newVersion = prompt.version + 1;
  await db.update(aiPromptsTable).set({ content: parsed.data.content, version: newVersion }).where(eq(aiPromptsTable.id, params.data.id));
  const [version] = await db.insert(aiPromptVersionsTable).values({
    promptId: params.data.id,
    version: newVersion,
    content: parsed.data.content,
    changeNote: parsed.data.changeNote ?? null,
  }).returning();
  res.status(201).json(CreatePromptVersionResponse.parse(version));
});

export default router;
