import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { aiClientMemoryTable, db } from "@workspace/db";

const router = Router();

const Query = z.object({
  clientId: z.string().trim().min(1).max(200),
});

const Upsert = z.object({
  clientId: z.string().trim().min(1).max(200),
  key: z.string().trim().min(1).max(200),
  value: z.string().max(20_000),
  valueType: z.enum(["string", "json", "array", "number"]).default("string"),
  category: z.string().trim().max(100).optional(),
  source: z.enum(["manual", "inferred", "approved_project"]).default("manual"),
  confidence: z.number().min(0).max(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

router.get("/ai/client-memory", async (req, res): Promise<void> => {
  const parsed = Query.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const rows = await db
    .select()
    .from(aiClientMemoryTable)
    .where(eq(aiClientMemoryTable.clientId, parsed.data.clientId))
    .orderBy(desc(aiClientMemoryTable.updatedAt));
  res.json(rows);
});

router.post("/ai/client-memory", async (req, res): Promise<void> => {
  const parsed = Upsert.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const confidence =
    parsed.data.confidence === undefined ? null : parsed.data.confidence.toFixed(3);

  const [row] = await db
    .insert(aiClientMemoryTable)
    .values({
      ...parsed.data,
      confidence,
      metadata: parsed.data.metadata ?? {},
    })
    .onConflictDoUpdate({
      target: [aiClientMemoryTable.clientId, aiClientMemoryTable.key],
      set: {
        value: parsed.data.value,
        valueType: parsed.data.valueType,
        category: parsed.data.category ?? null,
        source: parsed.data.source,
        confidence,
        metadata: parsed.data.metadata ?? {},
        updatedAt: new Date(),
      },
    })
    .returning();

  res.status(200).json(row);
});

router.delete("/ai/client-memory/:clientId/:key", async (req, res): Promise<void> => {
  const clientId = z.string().trim().min(1).max(200).safeParse(req.params["clientId"]);
  const key = z.string().trim().min(1).max(200).safeParse(req.params["key"]);
  if (!clientId.success || !key.success) {
    res.status(400).json({ error: "Invalid clientId or key" });
    return;
  }

  const rows = await db
    .delete(aiClientMemoryTable)
    .where(and(eq(aiClientMemoryTable.clientId, clientId.data), eq(aiClientMemoryTable.key, key.data)))
    .returning({ id: aiClientMemoryTable.id });
  res.status(rows.length ? 200 : 404).json({ deleted: rows.length > 0 });
});

export default router;
