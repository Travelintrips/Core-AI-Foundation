import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { db, aiKnowledgeBasesTable, aiKnowledgeDocumentsTable, aiAuditLogsTable } from "@workspace/db";
import {
  CreateKnowledgeBaseBody,
  UpdateKnowledgeBaseBody,
  GetKnowledgeBaseParams,
  UpdateKnowledgeBaseParams,
  DeleteKnowledgeBaseParams,
  ListKnowledgeDocumentsParams as ListDocumentsParams,
  AddKnowledgeDocumentParams as AddDocumentParams,
  AddKnowledgeDocumentBody,
  DeleteKnowledgeDocumentParams,
  ListKnowledgeBasesResponse,
  CreateKnowledgeBaseResponse,
  GetKnowledgeBaseResponse,
  UpdateKnowledgeBaseResponse,
  DeleteKnowledgeBaseResponse,
  ListKnowledgeDocumentsResponse,
  AddKnowledgeDocumentResponse,
  DeleteKnowledgeDocumentResponse,
} from "@workspace/api-zod";

const router = Router();

async function logAudit(module: string, action: string, resourceId: string, resourceType: string, status: "success" | "failure" = "success") {
  await db.insert(aiAuditLogsTable).values({ module, action, resourceId, resourceType, status, details: null });
}

router.get("/ai/knowledge-bases", async (_req, res): Promise<void> => {
  const kbs = await db.select().from(aiKnowledgeBasesTable).orderBy(aiKnowledgeBasesTable.createdAt);
  // Add document count
  const withCounts = await Promise.all(kbs.map(async (kb) => {
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(aiKnowledgeDocumentsTable).where(eq(aiKnowledgeDocumentsTable.knowledgeBaseId, kb.id));
    return { ...kb, documentCount: count };
  }));
  res.json(ListKnowledgeBasesResponse.parse(withCounts));
});

router.post("/ai/knowledge-bases", async (req, res): Promise<void> => {
  const parsed = CreateKnowledgeBaseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [kb] = await db.insert(aiKnowledgeBasesTable).values({
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    embeddingModel: parsed.data.embeddingModel,
    isActive: parsed.data.isActive ?? true,
    metadata: parsed.data.metadata ?? null,
  }).returning();
  await logAudit("knowledge", "create_kb", String(kb.id), "knowledge_base");
  res.status(201).json(CreateKnowledgeBaseResponse.parse({ ...kb, documentCount: 0 }));
});

router.get("/ai/knowledge-bases/:id", async (req, res): Promise<void> => {
  const params = GetKnowledgeBaseParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [kb] = await db.select().from(aiKnowledgeBasesTable).where(eq(aiKnowledgeBasesTable.id, params.data.id));
  if (!kb) { res.status(404).json({ error: "Knowledge base not found" }); return; }
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(aiKnowledgeDocumentsTable).where(eq(aiKnowledgeDocumentsTable.knowledgeBaseId, kb.id));
  res.json(GetKnowledgeBaseResponse.parse({ ...kb, documentCount: count }));
});

router.patch("/ai/knowledge-bases/:id", async (req, res): Promise<void> => {
  const params = UpdateKnowledgeBaseParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateKnowledgeBaseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const updateData: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if (parsed.data.embeddingModel !== undefined) updateData.embeddingModel = parsed.data.embeddingModel;
  if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;
  if (parsed.data.metadata !== undefined) updateData.metadata = parsed.data.metadata;
  const [kb] = await db.update(aiKnowledgeBasesTable).set(updateData).where(eq(aiKnowledgeBasesTable.id, params.data.id)).returning();
  if (!kb) { res.status(404).json({ error: "Knowledge base not found" }); return; }
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(aiKnowledgeDocumentsTable).where(eq(aiKnowledgeDocumentsTable.knowledgeBaseId, kb.id));
  await logAudit("knowledge", "update_kb", String(kb.id), "knowledge_base");
  res.json(UpdateKnowledgeBaseResponse.parse({ ...kb, documentCount: count }));
});

router.delete("/ai/knowledge-bases/:id", async (req, res): Promise<void> => {
  const params = DeleteKnowledgeBaseParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [kb] = await db.delete(aiKnowledgeBasesTable).where(eq(aiKnowledgeBasesTable.id, params.data.id)).returning();
  if (!kb) { res.status(404).json({ error: "Knowledge base not found" }); return; }
  await logAudit("knowledge", "delete_kb", String(params.data.id), "knowledge_base");
  res.sendStatus(204);
  DeleteKnowledgeBaseResponse.parse(undefined);
});

router.get("/ai/knowledge-bases/:id/documents", async (req, res): Promise<void> => {
  const params = ListDocumentsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const docs = await db.select().from(aiKnowledgeDocumentsTable).where(eq(aiKnowledgeDocumentsTable.knowledgeBaseId, params.data.id)).orderBy(aiKnowledgeDocumentsTable.createdAt);
  res.json(ListKnowledgeDocumentsResponse.parse(docs));
});

router.post("/ai/knowledge-bases/:id/documents", async (req, res): Promise<void> => {
  const params = AddDocumentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = AddKnowledgeDocumentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [doc] = await db.insert(aiKnowledgeDocumentsTable).values({
    knowledgeBaseId: params.data.id,
    title: parsed.data.title,
    content: parsed.data.content ?? null,
    contentType: parsed.data.contentType,
    sourceUrl: parsed.data.sourceUrl ?? null,
    status: "pending",
    metadata: parsed.data.metadata ?? null,
  }).returning();
  // Simulate indexing
  await db.update(aiKnowledgeDocumentsTable).set({ status: "indexed", chunkCount: Math.floor(Math.random() * 10 + 1) }).where(eq(aiKnowledgeDocumentsTable.id, doc.id));
  const [indexed] = await db.select().from(aiKnowledgeDocumentsTable).where(eq(aiKnowledgeDocumentsTable.id, doc.id));
  await logAudit("knowledge", "add_document", String(doc.id), "document");
  res.status(201).json(AddKnowledgeDocumentResponse.parse(indexed));
});

router.delete("/ai/knowledge-bases/:kbId/documents/:docId", async (req, res): Promise<void> => {
  const params = DeleteKnowledgeDocumentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [doc] = await db.delete(aiKnowledgeDocumentsTable).where(eq(aiKnowledgeDocumentsTable.id, params.data.docId)).returning();
  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
  await logAudit("knowledge", "delete_document", String(params.data.docId), "document");
  res.sendStatus(204);
  DeleteKnowledgeDocumentResponse.parse(undefined);
});

export default router;
