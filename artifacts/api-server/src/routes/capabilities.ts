import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, aiCapabilitiesTable } from "@workspace/db";
import { CreateCapabilityBody, UpdateCapabilityBody } from "@workspace/api-zod";
import { logAudit } from "../services/aiAuditService.js";

const router = Router();

function serializeCapability(row: typeof aiCapabilitiesTable.$inferSelect) {
  return {
    ...row,
    accuracyScore: row.accuracyScore != null ? Number(row.accuracyScore) : null,
    speedScore: row.speedScore != null ? Number(row.speedScore) : null,
    costScore: row.costScore != null ? Number(row.costScore) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** GET /capabilities — list all */
router.get("/capabilities", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(aiCapabilitiesTable)
    .orderBy(aiCapabilitiesTable.skill, aiCapabilitiesTable.priority);
  res.json(rows.map(serializeCapability));
});

/** GET /capabilities/skill/:skill — filter by skill */
router.get("/capabilities/skill/:skill", async (req, res): Promise<void> => {
  const { skill } = req.params;
  const rows = await db
    .select()
    .from(aiCapabilitiesTable)
    .where(eq(aiCapabilitiesTable.skill, skill))
    .orderBy(aiCapabilitiesTable.priority);
  res.json(rows.map(serializeCapability));
});

/** GET /capabilities/:id */
router.get("/capabilities/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.select().from(aiCapabilitiesTable).where(eq(aiCapabilitiesTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(serializeCapability(row));
});

/** POST /capabilities */
router.post("/capabilities", async (req, res): Promise<void> => {
  const parsed = CreateCapabilityBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const d = parsed.data;
  const [row] = await db.insert(aiCapabilitiesTable).values({
    providerId: d.providerId ?? null,
    modelId: d.modelId ?? null,
    agentSlug: d.agentSlug ?? null,
    skill: d.skill,
    accuracyScore: d.accuracyScore != null ? String(d.accuracyScore) : null,
    speedScore: d.speedScore != null ? String(d.speedScore) : null,
    costScore: d.costScore != null ? String(d.costScore) : null,
    maxContext: d.maxContext ?? null,
    supportsImage: d.supportsImage ?? false,
    supportsJson: d.supportsJson ?? true,
    supportsTool: d.supportsTool ?? false,
    supportsStream: d.supportsStream ?? false,
    priority: d.priority ?? 50,
    status: d.status ?? "active",
    notes: d.notes ?? null,
  }).returning();
  await logAudit("capabilities", "create", String(row.id), "ai_capability", "success", { skill: d.skill });
  res.status(201).json(serializeCapability(row));
});

/** PATCH /capabilities/:id */
router.patch("/capabilities/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = UpdateCapabilityBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const d = parsed.data;
  const updateData: Partial<typeof aiCapabilitiesTable.$inferInsert> = {};
  if (d.skill !== undefined) updateData.skill = d.skill;
  if (d.providerId !== undefined) updateData.providerId = d.providerId ?? null;
  if (d.modelId !== undefined) updateData.modelId = d.modelId ?? null;
  if (d.agentSlug !== undefined) updateData.agentSlug = d.agentSlug ?? null;
  if (d.accuracyScore !== undefined) updateData.accuracyScore = d.accuracyScore != null ? String(d.accuracyScore) : null;
  if (d.speedScore !== undefined) updateData.speedScore = d.speedScore != null ? String(d.speedScore) : null;
  if (d.costScore !== undefined) updateData.costScore = d.costScore != null ? String(d.costScore) : null;
  if (d.maxContext !== undefined) updateData.maxContext = d.maxContext ?? null;
  if (d.supportsImage !== undefined) updateData.supportsImage = d.supportsImage;
  if (d.supportsJson !== undefined) updateData.supportsJson = d.supportsJson;
  if (d.supportsTool !== undefined) updateData.supportsTool = d.supportsTool;
  if (d.supportsStream !== undefined) updateData.supportsStream = d.supportsStream;
  if (d.priority !== undefined) updateData.priority = d.priority;
  if (d.status !== undefined) updateData.status = d.status;
  if (d.notes !== undefined) updateData.notes = d.notes ?? null;

  const [row] = await db.update(aiCapabilitiesTable).set(updateData).where(eq(aiCapabilitiesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  await logAudit("capabilities", "update", String(id), "ai_capability", "success", {});
  res.json(serializeCapability(row));
});

/** DELETE /capabilities/:id */
router.delete("/capabilities/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.delete(aiCapabilitiesTable).where(eq(aiCapabilitiesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  await logAudit("capabilities", "delete", String(id), "ai_capability", "success", {});
  res.status(204).end();
});

export default router;
