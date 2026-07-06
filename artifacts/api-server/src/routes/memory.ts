import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, aiMemoryTable, aiAuditLogsTable } from "@workspace/db";
import {
  CreateMemoryEntryBody,
  ListMemoryEntriesQueryParams,
  GetMemoryEntryParams,
  DeleteMemoryEntryParams,
  ListMemoryEntriesResponse,
  CreateMemoryEntryResponse,
  GetMemoryEntryResponse,
  DeleteMemoryEntryResponse,
} from "@workspace/api-zod";

const router = Router();

async function logAudit(module: string, action: string, resourceId: string, resourceType: string, status: "success" | "failure" = "success") {
  await db.insert(aiAuditLogsTable).values({ module, action, resourceId, resourceType, status, details: null });
}

router.get("/ai/memory", async (req, res): Promise<void> => {
  const query = ListMemoryEntriesQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const entries = await db.select().from(aiMemoryTable).orderBy(aiMemoryTable.createdAt);
  let filtered = entries;
  if (query.data.agentId != null) filtered = filtered.filter(e => e.agentId === query.data.agentId);
  if (query.data.sessionId != null) filtered = filtered.filter(e => e.sessionId === query.data.sessionId);
  res.json(ListMemoryEntriesResponse.parse(filtered.map(e => ({ ...e, importance: e.importance != null ? Number(e.importance) : null }))));
});

router.post("/ai/memory", async (req, res): Promise<void> => {
  const parsed = CreateMemoryEntryBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [entry] = await db.insert(aiMemoryTable).values({
    agentId: parsed.data.agentId,
    sessionId: parsed.data.sessionId ?? null,
    memoryType: parsed.data.memoryType,
    content: parsed.data.content,
    key: parsed.data.key ?? null,
    importance: parsed.data.importance != null ? String(parsed.data.importance) : null,
    expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
    metadata: parsed.data.metadata ?? null,
  }).returning();
  await logAudit("memory", "create_memory", String(entry.id), "memory");
  res.status(201).json(CreateMemoryEntryResponse.parse({ ...entry, importance: entry.importance != null ? Number(entry.importance) : null }));
});

router.get("/ai/memory/:id", async (req, res): Promise<void> => {
  const params = GetMemoryEntryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [entry] = await db.select().from(aiMemoryTable).where(eq(aiMemoryTable.id, params.data.id));
  if (!entry) { res.status(404).json({ error: "Memory entry not found" }); return; }
  res.json(GetMemoryEntryResponse.parse({ ...entry, importance: entry.importance != null ? Number(entry.importance) : null }));
});

router.delete("/ai/memory/:id", async (req, res): Promise<void> => {
  const params = DeleteMemoryEntryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [entry] = await db.delete(aiMemoryTable).where(eq(aiMemoryTable.id, params.data.id)).returning();
  if (!entry) { res.status(404).json({ error: "Memory entry not found" }); return; }
  await logAudit("memory", "delete_memory", String(params.data.id), "memory");
  res.sendStatus(204);
  DeleteMemoryEntryResponse.parse(undefined);
});

export default router;
