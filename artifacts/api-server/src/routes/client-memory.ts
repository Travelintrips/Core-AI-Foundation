import { Router } from "express";
import { UpsertClientMemoryBody } from "@workspace/api-zod";
import {
  getClientMemory,
  upsertClientMemory,
  deleteClientMemoryKey,
} from "../services/memoryService.js";

const router = Router();

/** GET /client-memory/:clientId — get all memory entries for a client */
router.get("/client-memory/:clientId", async (req, res): Promise<void> => {
  const { clientId } = req.params;
  const entries = await getClientMemory(clientId);
  res.json({ clientId, entries });
});

/** POST /client-memory/:clientId — upsert a key-value entry */
router.post("/client-memory/:clientId", async (req, res): Promise<void> => {
  const { clientId } = req.params;
  const parsed = UpsertClientMemoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;
  await upsertClientMemory(clientId, d.key, d.value, {
    valueType: d.valueType,
    category: d.category ?? undefined,
    source: d.source,
    confidence: d.confidence ?? undefined,
  });
  const entries = await getClientMemory(clientId);
  res.json({ clientId, entries });
});

/** DELETE /client-memory/:clientId/:key — delete a specific memory key */
router.delete("/client-memory/:clientId/:key", async (req, res): Promise<void> => {
  const { clientId, key } = req.params;
  await deleteClientMemoryKey(clientId, key);
  res.status(204).end();
});

export default router;
